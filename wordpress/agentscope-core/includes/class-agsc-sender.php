<?php
/**
 * Sends the daily traffic totals from the agsc_traffic table to the AgentScope app, once a day.
 * Only the aggregated rows are sent (day, source, category, confidence, route, http_status, hits, last_seen).
 * No IP, user agent, URL or cookie leaves the site. Requests are signed with HMAC-SHA256.
 * The same connection token signs AgentScope's own check requests (see AGSC_Check).
 *
 * Connect from Settings: paste the connection code the app shows (Settings → AI traffic plugin). The code is
 * "agsc1." followed by base64url JSON {"endpoint","store_id","token"}. A plain "agsc_…" token also works when the
 * endpoint and store ID are already saved.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Sender {
    const OPTION    = 'agsc_remote';
    const CRON      = 'agsc_send_traffic';
    const LAST      = 'agsc_remote_last_result';
    const SEND_DAYS = 3; // Resend the last 3 days: totals are replaced, so late hits are corrected.
    const MAX_ROWS  = 1000;
    const CRON_NOW  = 'agsc_send_traffic_now';

    /**
     * Sends in the background (a one-off WP-Cron event), so no admin page waits for the network.
     * $since: first day to send (default: the last SEND_DAYS days).
     */
    public static function send_soon($since = null) {
        $args = $since ? array((string) $since) : array();
        if (!wp_next_scheduled(self::CRON_NOW, $args)) {
            wp_schedule_single_event(time(), self::CRON_NOW, $args);
        }
        self::remember('Queued: sending in the background.');
    }

    public static function init() {
        add_action(self::CRON, array(__CLASS__, 'send_scheduled'));
        add_action(self::CRON_NOW, array(__CLASS__, 'send'));
        add_action('admin_post_agsc_connect', array(__CLASS__, 'handle_connect'));
        add_action('admin_post_agsc_send_now', array(__CLASS__, 'handle_send_now'));
        add_action('admin_post_agsc_disconnect', array(__CLASS__, 'handle_disconnect'));
        if (!wp_next_scheduled(self::CRON)) {
            wp_schedule_event(time() + 15 * MINUTE_IN_SECONDS, 'daily', self::CRON);
        }
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON);
        wp_clear_scheduled_hook(self::CRON_NOW);
    }

    public static function settings() {
        $saved = get_option(self::OPTION, array());
        $s = array_merge(array('endpoint' => '', 'store_id' => '', 'token' => ''), is_array($saved) ? $saved : array());
        foreach ($s as $k => $v) {
            $s[$k] = (string) $v;
        }
        return $s;
    }

    public static function is_configured($s = null) {
        $s = $s ? $s : self::settings();
        return strpos($s['endpoint'], 'https://') === 0
            && preg_match('/^[0-9a-f-]{36}$/i', $s['store_id'])
            && strpos($s['token'], 'agsc_') === 0;
    }

    /**
     * Reads a connection code (agsc1.<base64url JSON>) or a plain token. Returns the new settings, or a string error.
     */
    public static function parse_code($code, $current) {
        $code = trim((string) $code);
        if (strpos($code, 'agsc1.') === 0) {
            $json = base64_decode(strtr(substr($code, 6), '-_', '+/'), true);
            $data = $json ? json_decode($json, true) : null;
            if (!is_array($data) || !isset($data['endpoint'], $data['store_id'], $data['token'])) {
                return 'This connection code is not valid. Copy it again from the app.';
            }
            $next = array('endpoint' => (string) $data['endpoint'], 'store_id' => (string) $data['store_id'], 'token' => (string) $data['token']);
        } elseif (strpos($code, 'agsc_') === 0) {
            $next = array_merge($current, array('token' => $code));
        } else {
            return 'Paste the connection code from the app (it starts with agsc1.).';
        }
        if (!self::is_configured($next)) {
            return 'The connection code is incomplete (endpoint must be https, store ID a UUID, token agsc_…).';
        }
        return $next;
    }

    public static function send_scheduled() {
        self::send();
    }

    /**
     * Collects the totals from $since (default: the last SEND_DAYS days) and posts them. Returns a short result.
     */
    public static function send($since = null) {
        global $wpdb;
        $s = self::settings();
        if (!self::is_configured($s)) {
            return self::remember('Not connected.');
        }

        $table = AGSC_Traffic::table();
        $since = $since ? $since : gmdate('Y-m-d', time() - (self::SEND_DAYS - 1) * DAY_IN_SECONDS);
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT day, source, category, confidence, route, http_status, hits, last_seen FROM {$table} WHERE day >= %s ORDER BY day ASC LIMIT %d",
            $since,
            self::MAX_ROWS
        ), ARRAY_A);

        $clean = array();
        foreach ((array) $rows as $row) {
            $clean[] = array(
                'day'         => (string) $row['day'],
                'source'      => (string) $row['source'],
                'category'    => (string) $row['category'],
                'confidence'  => (string) $row['confidence'],
                'route'       => (string) $row['route'],
                'http_status' => (int) $row['http_status'],
                'hits'        => (int) $row['hits'],
                'last_seen'   => (string) $row['last_seen'],
            );
        }

        $body = wp_json_encode(array('rows' => $clean));
        $timestamp = (string) time();
        $signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $s['token']);

        $response = wp_remote_post($s['endpoint'], array(
            'timeout' => 20,
            'headers' => array(
                'Content-Type'           => 'application/json',
                'X-AgentScope-Store'     => $s['store_id'],
                'X-AgentScope-Timestamp' => $timestamp,
                'X-AgentScope-Signature' => $signature,
            ),
            'body'    => $body,
        ));

        if (is_wp_error($response)) {
            return self::remember('Failed: ' . $response->get_error_message());
        }
        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            $data = json_decode(wp_remote_retrieve_body($response), true);
            $error = is_array($data) && isset($data['error']) ? (string) $data['error'] : 'HTTP ' . $code;
            return self::remember('Failed: ' . $error);
        }
        return self::remember('Sent ' . count($clean) . ' rows.');
    }

    private static function remember($message) {
        update_option(self::LAST, array('time' => time(), 'message' => $message), false);
        return $message;
    }

    private static function back($msg) {
        wp_safe_redirect(add_query_arg(array('page' => 'agsc-settings', 'agsc_msg' => $msg), admin_url('admin.php')));
        exit;
    }

    public static function handle_connect() {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.', 403);
        }
        check_admin_referer('agsc_connect');
        $code = isset($_POST['connection_code']) ? sanitize_text_field(wp_unslash($_POST['connection_code'])) : '';
        $next = self::parse_code($code, self::settings());
        if (is_string($next)) {
            set_transient('agsc_connect_error', $next, 60);
            self::back('connect-failed');
        }
        update_option(self::OPTION, $next, false);
        self::send_soon();
        self::back('connected');
    }

    public static function handle_send_now() {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.', 403);
        }
        check_admin_referer('agsc_send_now');
        self::send_soon();
        self::back('sent');
    }

    public static function handle_disconnect() {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.', 403);
        }
        check_admin_referer('agsc_disconnect');
        delete_option(self::OPTION);
        self::remember('Disconnected.');
        self::back('disconnected');
    }

    /** The "Connect to the AgentScope app" section of the Settings page. */
    public static function render_section() {
        $s = self::settings();
        $connected = self::is_configured($s);
        $last = get_option(self::LAST, array());
        $next = wp_next_scheduled(self::CRON);
        $error = get_transient('agsc_connect_error');
        if ($error) {
            delete_transient('agsc_connect_error');
        }
        echo '<h2 class="agsc-h2">Connect to the AgentScope app</h2>';
        echo '<div class="agsc-form">';
        echo '<p class="agsc-help agsc-help--flush">Sends the daily AI traffic totals (no IPs, user agents, URLs or cookies) once a day. The same connection signs AgentScope\'s own checks, so they are never counted as traffic.</p>';
        if ($error) {
            echo '<div class="agsc-notice agsc-notice--bad" role="alert">' . esc_html($error) . '</div>';
        }
        if ($connected) {
            echo '<p><strong>Connected</strong> to store ' . esc_html($s['store_id']) . ' with token …' . esc_html(substr($s['token'], -4)) . '.</p>';
        } else {
            echo '<p><strong>Not connected.</strong> In the app: Settings → AI traffic plugin → Connect traffic plugin, then paste the connection code here.</p>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        echo '<input type="hidden" name="action" value="agsc_connect">';
        wp_nonce_field('agsc_connect');
        echo '<label class="agsc-field agsc-field--wide">Connection token <input type="password" name="connection_code" autocomplete="off" placeholder="' . esc_attr($connected ? 'Saved. Paste a new code to replace it.' : 'agsc1.…') . '"></label>';
        echo '<button type="submit" class="agsc-btn">Connect</button></form>';
        if ($connected) {
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="agsc-inline">';
            echo '<input type="hidden" name="action" value="agsc_send_now">';
            wp_nonce_field('agsc_send_now');
            echo '<button type="submit" class="agsc-btn agsc-btn--ghost">Send now</button></form> ';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="agsc-inline" onsubmit="return confirm(\'Disconnect from the AgentScope app?\');">';
            echo '<input type="hidden" name="action" value="agsc_disconnect">';
            wp_nonce_field('agsc_disconnect');
            echo '<button type="submit" class="agsc-btn agsc-btn--ghost">Disconnect</button></form>';
        }
        echo '<p class="agsc-meta">Last send: ' . (isset($last['message']) ? esc_html($last['message'] . ' (' . gmdate('Y-m-d H:i', (int) $last['time']) . ' UTC)') : 'none yet') . '<br>';
        echo 'Next automatic send: ' . ($next ? esc_html(gmdate('Y-m-d H:i', $next) . ' UTC') : 'not scheduled') . '</p>';
        echo '</div>';
    }
}
