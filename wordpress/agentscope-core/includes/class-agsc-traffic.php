<?php
/**
 * Opt-in aggregated AI traffic signals.
 * Stores only daily counters per source/category/route/status. No IP, no raw user agent, no URL, no cookie.
 * Only requests handled by WordPress PHP are seen; cached pages served by a host or CDN are not.
 * AgentScope's own checks (X-AgentScope-Check header, see AGSC_Check) are never counted.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Traffic {
    const TABLE   = 'agsc_traffic';
    const CRON    = 'agsc_daily_purge';
    // Day up to which totals were recorded by a version that also counted AgentScope's own checks.
    const LEGACY  = 'agsc_legacy_until';
    const CLEARED = 'agsc_test_data_cleared';

    private static $route = 'other';

    public static function table() {
        global $wpdb;
        return $wpdb->prefix . self::TABLE;
    }

    public static function activate() {
        self::install();
        self::schedule();
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON);
    }

    public static function maybe_upgrade() {
        if (get_option('agsc_db_version') !== AGSC_DB_VERSION) {
            self::install();
        }
        $previous = get_option('agsc_version');
        if ($previous !== AGSC_VERSION) {
            // Upgrading from 1.0.x (no agsc_version option, but the table was installed): earlier totals may include
            // AgentScope's own test requests. Remember up to which day, so Settings can offer to clear them.
            // A fresh install has no rows, so nothing is marked.
            if (($previous === false || version_compare((string) $previous, '1.1.0', '<')) && !get_option(self::LEGACY) && self::has_hits()) {
                update_option(self::LEGACY, gmdate('Y-m-d'), false);
            }
            update_option('agsc_version', AGSC_VERSION, false);
        }
        self::schedule();
    }

    private static function schedule() {
        if (!wp_next_scheduled(self::CRON)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CRON);
        }
    }

    public static function install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $table = self::table();
        $sql = "CREATE TABLE {$table} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  day date NOT NULL,
  source varchar(40) NOT NULL,
  category varchar(30) NOT NULL,
  confidence varchar(30) NOT NULL,
  route varchar(30) NOT NULL,
  http_status smallint(5) unsigned NOT NULL DEFAULT 0,
  hits int(10) unsigned NOT NULL DEFAULT 0,
  last_seen datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY bucket (day,source,category,confidence,route,http_status),
  KEY day (day)
) {$charset};";
        dbDelta($sql);
        AGSC_Bothits::install();
        update_option('agsc_db_version', AGSC_DB_VERSION);
    }

    public static function init() {
        add_action('wp', array(__CLASS__, 'detect_route'));
        add_action('shutdown', array(__CLASS__, 'record'), 0);
        add_action(self::CRON, array(__CLASS__, 'purge'));
    }

    public static function detect_route() {
        $route = 'other';
        if (function_exists('is_robots') && is_robots()) {
            $route = 'robots';
        } elseif (get_query_var('sitemap')) {
            $route = 'sitemap';
        } elseif (is_feed()) {
            $route = 'feed';
        } elseif (is_404()) {
            $route = 'not-found';
        } elseif (is_front_page() || is_home()) {
            $route = 'home';
        } elseif (function_exists('is_product') && is_product()) {
            $route = 'product';
        } elseif (function_exists('is_cart') && is_cart()) {
            $route = 'cart';
        } elseif (function_exists('is_checkout') && is_checkout()) {
            $route = 'checkout';
        } elseif (function_exists('is_shop') && (is_shop() || (function_exists('is_product_taxonomy') && is_product_taxonomy()))) {
            $route = 'catalog';
        } elseif (is_search()) {
            $route = 'search';
        } elseif (is_singular()) {
            $route = 'content';
        }
        self::$route = $route;
    }

    public static function record() {
        $settings = AGSC_Settings::get();
        if (empty($settings['capture_enabled'])) {
            return;
        }
        if (is_admin() || wp_doing_ajax() || wp_doing_cron()) {
            return;
        }
        if ((defined('REST_REQUEST') && REST_REQUEST) || (defined('WP_CLI') && WP_CLI) || (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST)) {
            return;
        }
        // AgentScope's own access tests use AI bot user agents on purpose; they are not traffic.
        if (AGSC_Check::is_agentscope_request()) {
            return;
        }
        $method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : 'GET';
        if ($method !== 'GET' && $method !== 'HEAD') {
            return;
        }
        $ua  = isset($_SERVER['HTTP_USER_AGENT']) ? (string) wp_unslash($_SERVER['HTTP_USER_AGENT']) : '';
        $ref = isset($_SERVER['HTTP_REFERER']) ? (string) wp_unslash($_SERVER['HTTP_REFERER']) : '';
        $signal = AGSC_Signals::classify($ua, $ref);
        if (!$signal) {
            return;
        }
        $status = (int) http_response_code();
        if ($status < 100 || $status > 599) {
            $status = 0;
        }
        $day = gmdate('Y-m-d');
        // Several AI bots within a minute look like a checker tool, not real AI traffic (HEURISTIC, see AGSC_Burst).
        if ($signal['confidence'] === 'unverified-user-agent' && AGSC_Burst::observe($signal, $day, self::$route, $status)) {
            $signal['confidence'] = AGSC_Burst::CONFIDENCE;
        }
        self::increment($day, $signal, self::$route, $status);
        // AI bot user agents only (never people, never a checker-tool burst): for the identity check in the app.
        if ($signal['category'] !== 'human-ai-referral' && $signal['confidence'] !== AGSC_Burst::CONFIDENCE) {
            AGSC_Bothits::record($ua, $method, $status);
        }
    }

    /** Moves one already counted request of a burst from unverified-user-agent to likely-checker-tool. */
    public static function move_to_checker($e) {
        global $wpdb;
        $table = self::table();
        $moved = $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET hits = hits - 1 WHERE day = %s AND source = %s AND category = %s AND confidence = 'unverified-user-agent' AND route = %s AND http_status = %d AND hits > 0",
            $e['day'],
            $e['source'],
            $e['category'],
            $e['route'],
            (int) $e['status']
        ));
        if ($moved) {
            self::increment($e['day'], array('source' => $e['source'], 'category' => $e['category'], 'confidence' => AGSC_Burst::CONFIDENCE), $e['route'], (int) $e['status']);
        }
    }

    private static function increment($day, $signal, $route, $status) {
        global $wpdb;
        $table = self::table();
        $wpdb->query($wpdb->prepare(
            "INSERT INTO {$table} (day, source, category, confidence, route, http_status, hits, last_seen)
             VALUES (%s, %s, %s, %s, %s, %d, 1, %s)
             ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = VALUES(last_seen)",
            $day,
            $signal['source'],
            $signal['category'],
            $signal['confidence'],
            $route,
            $status,
            current_time('mysql', true)
        ));
    }

    const CLEAR_LOG = 'agsc_clear_log';

    /** A YYYY-MM-DD day that exists and is not after $today (pure, tested from the command line). */
    public static function valid_day($day, $today) {
        if (!is_string($day) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $day, $m)) {
            return false;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) && strcmp($day, (string) $today) <= 0;
    }

    /**
     * Sets to 0 the totals of the days from $from to $to (inclusive). Rows are kept with 0 hits so the next send
     * replaces the app's copy with 0 too. Can be repeated. Returns the number of rows changed.
     */
    public static function clear_days($from, $to, $reason) {
        global $wpdb;
        $table = self::table();
        $changed = (int) $wpdb->query($wpdb->prepare("UPDATE {$table} SET hits = 0 WHERE day >= %s AND day <= %s AND hits > 0", $from, $to));
        $log = get_option(self::CLEAR_LOG, array());
        $log = is_array($log) ? $log : array();
        $log[] = array('time' => time(), 'from' => $from, 'to' => $to, 'rows' => $changed, 'reason' => $reason);
        update_option(self::CLEAR_LOG, array_slice($log, -10), false);
        return $changed;
    }

    /** Sets to 0 every total up to the legacy day (before 1.1.0, when AgentScope's own checks were counted). */
    public static function clear_legacy() {
        $until = get_option(self::LEGACY);
        if (!$until) {
            return 0;
        }
        $changed = self::clear_days('2000-01-01', (string) $until, 'before 1.1.0');
        update_option(self::CLEARED, array('time' => time(), 'until' => $until, 'rows' => $changed), false);
        return $changed;
    }

    private static function has_hits() {
        global $wpdb;
        $table = self::table();
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE hits > 0") > 0; // phpcs:ignore -- no user input.
    }

    /** Oldest day that still has rows, for resending the cleared days. */
    public static function first_day() {
        global $wpdb;
        $table = self::table();
        $day = $wpdb->get_var("SELECT MIN(day) FROM {$table}"); // phpcs:ignore -- no user input.
        return $day ? (string) $day : null;
    }

    public static function purge() {
        global $wpdb;
        $settings = AGSC_Settings::get();
        $cutoff = gmdate('Y-m-d', time() - ((int) $settings['retention_days'] * DAY_IN_SECONDS));
        $table = self::table();
        $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE day < %s", $cutoff));
    }

    private static function normalize_rows($rows) {
        if (!is_array($rows)) {
            return array();
        }
        $clean = array();
        foreach ($rows as $row) {
            $row['hits'] = isset($row['hits']) ? (int) $row['hits'] : 0;
            if (isset($row['http_status'])) {
                $row['http_status'] = (int) $row['http_status'];
            }
            $clean[] = $row;
        }
        return $clean;
    }

    public static function summary($days = 30) {
        global $wpdb;
        $days = max(1, min(365, (int) $days));
        $since = gmdate('Y-m-d', time() - (($days - 1) * DAY_IN_SECONDS));
        $table = self::table();
        $settings = AGSC_Settings::get();

        $totals = $wpdb->get_results($wpdb->prepare(
            "SELECT category, SUM(hits) AS hits FROM {$table} WHERE day >= %s AND hits > 0 AND confidence <> 'likely-checker-tool' GROUP BY category ORDER BY hits DESC",
            $since
        ), ARRAY_A);
        $sources = $wpdb->get_results($wpdb->prepare(
            "SELECT source, category, confidence, SUM(hits) AS hits, MAX(last_seen) AS last_seen FROM {$table} WHERE day >= %s AND hits > 0 GROUP BY source, category, confidence ORDER BY hits DESC",
            $since
        ), ARRAY_A);
        $routes = $wpdb->get_results($wpdb->prepare(
            "SELECT route, source, category, http_status, SUM(hits) AS hits, MAX(last_seen) AS last_seen FROM {$table} WHERE day >= %s AND hits > 0 GROUP BY route, source, category, http_status ORDER BY hits DESC LIMIT 50",
            $since
        ), ARRAY_A);
        $daily = $wpdb->get_results($wpdb->prepare(
            "SELECT day, SUM(hits) AS hits FROM {$table} WHERE day >= %s AND confidence <> 'likely-checker-tool' GROUP BY day ORDER BY day ASC",
            $since
        ), ARRAY_A);
        $checker = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(hits), 0) FROM {$table} WHERE day >= %s AND confidence = 'likely-checker-tool'",
            $since
        ));

        $totals  = self::normalize_rows($totals);
        $sources = self::normalize_rows($sources);
        $routes  = self::normalize_rows($routes);
        $daily   = self::normalize_rows($daily);

        $total = 0;
        foreach ($totals as $row) {
            $total += $row['hits'];
        }

        $legacy = get_option(self::LEGACY);
        $cleared = get_option(self::CLEARED);
        return array(
            'data_label'      => 'OBSERVED',
            'period_days'     => $days,
            'since_utc'       => $since,
            'capture_enabled' => (bool) $settings['capture_enabled'],
            'total_hits'      => $total,
            'likely_checker_hits' => $checker,
            'likely_checker_rule' => 'HEURISTIC: 3+ different AI sources, or 5+ AI bot requests with 3+ different bot names, within 60 seconds are counted apart as likely-checker-tool (probably an SEO/GEO checker tool). Not proof either way.',
            'totals'          => $totals,
            'sources'         => $sources,
            'routes'          => $routes,
            'daily'           => $daily,
            'agentscope_checks' => array(
                'ignored_since_version' => '1.1.0',
                'legacy_until_utc'      => $legacy ? (string) $legacy : null,
                'legacy_cleared'        => is_array($cleared),
            ),
            'caveat'          => 'Counts only WordPress PHP-handled GET/HEAD requests while capture is on. User agents and referrers are unverified and can be spoofed. Pages served from a host or CDN cache are not counted. AgentScope\'s own checks are not counted from version 1.1.0. Bursts of several AI bots within a minute are counted apart as likely checker tools (heuristic) from version 1.2.0. This is not proof of AI recommendations, visits by real customers, or sales.',
        );
    }
}
