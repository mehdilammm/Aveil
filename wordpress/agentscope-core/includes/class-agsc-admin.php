<?php
/**
 * Admin workspace: Overview, AI Traffic, Store Readiness, Fix Center, AI Visibility, Reports, Settings.
 * Every number shown here comes from stored scan or traffic data. Nothing is estimated.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Admin {
    const CAP = 'manage_options';

    private static function pages() {
        return array(
            'agsc-overview'   => 'Overview',
            'agsc-traffic'    => 'AI Traffic',
            'agsc-readiness'  => 'Store Readiness',
            'agsc-fixes'      => 'Fix Center',
            'agsc-visibility' => 'AI Visibility',
            'agsc-reports'    => 'Reports',
            'agsc-settings'   => 'Settings',
        );
    }

    public static function init() {
        add_action('admin_menu', array(__CLASS__, 'menu'));
        add_action('admin_enqueue_scripts', array(__CLASS__, 'assets'));
        add_action('admin_post_agsc_run_scan', array(__CLASS__, 'handle_scan'));
        add_action('admin_post_agsc_save_settings', array(__CLASS__, 'handle_settings'));
        add_action('admin_post_agsc_export', array(__CLASS__, 'handle_export'));
        add_action('admin_post_agsc_clear_test_data', array(__CLASS__, 'handle_clear_test_data'));
    }

    public static function menu() {
        add_menu_page('AgentScope', 'AgentScope', self::CAP, 'agsc-overview', array(__CLASS__, 'render'), 'dashicons-visibility', 56);
        foreach (self::pages() as $slug => $label) {
            add_submenu_page('agsc-overview', $label . ' - AgentScope', $label, self::CAP, $slug, array(__CLASS__, 'render'));
        }
    }

    public static function assets($hook) {
        if (strpos((string) $hook, 'agsc-') === false) {
            return;
        }
        wp_enqueue_style('agsc-admin', AGSC_URL . 'assets/admin.css', array(), AGSC_VERSION);
    }

    private static function current_page() {
        $page = isset($_GET['page']) ? sanitize_key(wp_unslash($_GET['page'])) : 'agsc-overview';
        $pages = self::pages();
        return isset($pages[$page]) ? $page : 'agsc-overview';
    }

    private static function page_url($slug, $args = array()) {
        return add_query_arg(array_merge(array('page' => $slug), $args), admin_url('admin.php'));
    }

    /* ---------- actions ---------- */

    public static function handle_scan() {
        if (!current_user_can(self::CAP)) {
            wp_die('You do not have permission to run a scan.');
        }
        check_admin_referer('agsc_run_scan');
        $scan = AGSC_Readiness::run_and_save();
        $back = isset($_POST['back']) ? sanitize_key(wp_unslash($_POST['back'])) : 'agsc-readiness';
        $msg = (isset($scan['status']) && $scan['status'] === 'complete') ? 'scanned' : 'scan-failed';
        wp_safe_redirect(self::page_url(array_key_exists($back, self::pages()) ? $back : 'agsc-readiness', array('agsc_msg' => $msg)));
        exit;
    }

    public static function handle_settings() {
        if (!current_user_can(self::CAP)) {
            wp_die('You do not have permission to change settings.');
        }
        check_admin_referer('agsc_save_settings');
        AGSC_Settings::update(array(
            'capture_enabled'     => !empty($_POST['capture_enabled']),
            'delete_on_uninstall' => !empty($_POST['delete_on_uninstall']),
            'retention_days'      => isset($_POST['retention_days']) ? (int) $_POST['retention_days'] : 30,
        ));
        wp_safe_redirect(self::page_url('agsc-settings', array('agsc_msg' => 'saved')));
        exit;
    }

    // Sets to 0 the totals recorded before 1.1.0 (they may include AgentScope's own checks), only after the admin
    // ticks the confirmation box. When connected, the zeroed days are sent so the app's copy is corrected too.
    public static function handle_clear_test_data() {
        if (!current_user_can(self::CAP)) {
            wp_die('You do not have permission to change traffic data.');
        }
        check_admin_referer('agsc_clear_test_data');
        if (empty($_POST['confirm_clear'])) {
            wp_safe_redirect(self::page_url('agsc-settings', array('agsc_msg' => 'clear-unconfirmed')));
            exit;
        }
        AGSC_Traffic::clear_legacy();
        if (AGSC_Sender::is_configured()) {
            $first = AGSC_Traffic::first_day();
            AGSC_Sender::send($first);
        }
        wp_safe_redirect(self::page_url('agsc-settings', array('agsc_msg' => 'cleared')));
        exit;
    }

    private static function csv_cell($value) {
        if (is_int($value) || is_float($value)) {
            return $value;
        }
        $value = (string) $value;
        if ($value !== '' && !is_numeric($value) && in_array($value[0], array('=', '+', '-', '@', "\t", "\r"), true)) {
            $value = "'" . $value;
        }
        return $value;
    }

    public static function handle_export() {
        if (!current_user_can(self::CAP)) {
            wp_die('You do not have permission to export reports.');
        }
        check_admin_referer('agsc_export');
        $type = isset($_GET['type']) ? sanitize_key(wp_unslash($_GET['type'])) : 'findings';

        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=agentscope-' . $type . '-' . gmdate('Ymd-His') . '.csv');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");

        if ($type === 'traffic') {
            $traffic = AGSC_Traffic::summary(30);
            fputcsv($out, array('data_label', 'route', 'source', 'category', 'http_status', 'hits_30_days', 'last_seen_utc'));
            foreach ($traffic['routes'] as $row) {
                fputcsv($out, array_map(array(__CLASS__, 'csv_cell'), array('OBSERVED', $row['route'], $row['source'], $row['category'], (int) $row['http_status'], (int) $row['hits'], $row['last_seen'])));
            }
            fputcsv($out, array(self::csv_cell('Note: ' . $traffic['caveat'])));
        } else {
            $scan = AGSC_Readiness::current();
            fputcsv($out, array('scan_utc', 'severity', 'state', 'basis', 'id', 'title', 'evidence', 'guidance', 'product_id'));
            if (isset($scan['findings']) && is_array($scan['findings'])) {
                foreach ($scan['findings'] as $f) {
                    fputcsv($out, array_map(array(__CLASS__, 'csv_cell'), array(
                        $scan['created_utc'], $f['severity'], isset($f['state']) ? $f['state'] : '', $f['basis'],
                        $f['id'], $f['title'], $f['evidence'], $f['guidance'], (int) $f['product_id'],
                    )));
                }
            }
        }
        fclose($out);
        exit;
    }

    /* ---------- rendering helpers ---------- */

    private static function badge($severity) {
        $labels = array('high' => 'Critical', 'medium' => 'Warning', 'low' => 'Review');
        $label = isset($labels[$severity]) ? $labels[$severity] : $severity;
        return '<span class="agsc-badge agsc-badge--' . esc_attr($severity) . '">' . esc_html($label) . '</span>';
    }

    private static function label($text) {
        return '<span class="agsc-data agsc-data--' . esc_attr(strtolower($text)) . '">' . esc_html($text) . '</span>';
    }

    private static function scan_button($back) {
        $html  = '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="agsc-inline">';
        $html .= '<input type="hidden" name="action" value="agsc_run_scan">';
        $html .= '<input type="hidden" name="back" value="' . esc_attr($back) . '">';
        $html .= wp_nonce_field('agsc_run_scan', '_wpnonce', true, false);
        $html .= '<button type="submit" class="agsc-btn">Run scan</button></form>';
        return $html;
    }

    private static function export_url($type) {
        return wp_nonce_url(add_query_arg(array('action' => 'agsc_export', 'type' => $type), admin_url('admin-post.php')), 'agsc_export');
    }

    private static function notice() {
        $msg = isset($_GET['agsc_msg']) ? sanitize_key(wp_unslash($_GET['agsc_msg'])) : '';
        $texts = array(
            'scanned'           => array('ok', 'Scan finished. Results below are from this scan.'),
            'scan-failed'       => array('bad', 'Scan did not run. WooCommerce must be active.'),
            'saved'             => array('ok', 'Settings saved.'),
            'connected'         => array('ok', 'Connected to the AgentScope app. A first send was attempted; see "Last send".'),
            'connect-failed'    => array('bad', 'Not connected.'),
            'disconnected'      => array('ok', 'Disconnected from the AgentScope app.'),
            'sent'              => array('ok', 'Send attempted; see "Last send".'),
            'cleared'           => array('ok', 'Test data cleared: totals recorded before version 1.1.0 are now 0.'),
            'clear-unconfirmed' => array('bad', 'Nothing was cleared. Tick the confirmation box first.'),
        );
        if (!isset($texts[$msg])) {
            return '';
        }
        return '<div class="agsc-notice agsc-notice--' . $texts[$msg][0] . '" role="status">' . esc_html($texts[$msg][1]) . '</div>';
    }

    // Totals from before 1.1.0 may include AgentScope's own checks, until the admin clears them.
    private static function legacy_notice() {
        $until = get_option(AGSC_Traffic::LEGACY);
        if (!$until || get_option(AGSC_Traffic::CLEARED)) {
            return '';
        }
        return '<div class="agsc-notice agsc-notice--warn" role="status">Totals recorded up to ' . esc_html((string) $until) . ' (before version 1.1.0) may include AgentScope\'s own checks, which use AI bot user agents. <a href="' . esc_url(self::page_url('agsc-settings')) . '#agsc-clear">Clear test data in Settings</a>.</div>';
    }

    private static function open_findings($scan) {
        if (!isset($scan['findings']) || !is_array($scan['findings'])) {
            return array();
        }
        return $scan['findings'];
    }

    /* ---------- page router ---------- */

    public static function render() {
        if (!current_user_can(self::CAP)) {
            wp_die('You do not have permission to view this page.');
        }
        $current = self::current_page();
        echo '<div class="wrap agsc"><div class="agsc-shell">';
        echo '<nav class="agsc-nav" aria-label="AgentScope"><div class="agsc-brand">AgentScope</div><ul>';
        foreach (self::pages() as $slug => $label) {
            $active = ($slug === $current) ? ' aria-current="page" class="is-active"' : '';
            echo '<li><a href="' . esc_url(self::page_url($slug)) . '"' . $active . '>' . esc_html($label) . '</a></li>';
        }
        echo '</ul><p class="agsc-nav-foot">v' . esc_html(AGSC_VERSION) . '</p></nav>';
        echo '<main class="agsc-main">';
        echo self::notice(); // phpcs:ignore -- escaped inside.
        if (in_array($current, array('agsc-overview', 'agsc-traffic'), true)) {
            echo self::legacy_notice(); // phpcs:ignore -- escaped inside.
        }
        $method = 'page_' . str_replace('-', '_', substr($current, 5));
        if (method_exists(__CLASS__, $method)) {
            self::$method();
        }
        echo '</main></div></div>';
    }

    /* ---------- pages ---------- */

    private static function page_overview() {
        $scan = AGSC_Readiness::current();
        $traffic = AGSC_Traffic::summary(30);
        echo '<h1 class="agsc-title">Overview</h1>';
        echo '<p class="agsc-lead">What AgentScope measured on this store, and what it could not measure.</p>';

        echo '<div class="agsc-grid">';
        echo '<section class="agsc-panel"><h2>Store readiness</h2>';
        if ($scan['status'] === 'complete') {
            $c = $scan['severity_counts'];
            echo '<p class="agsc-figure">' . (int) $scan['findings_count'] . '<span> findings</span></p>';
            echo '<p>' . self::badge('high') . ' ' . (int) $c['high'] . ' &nbsp; ' . self::badge('medium') . ' ' . (int) $c['medium'] . ' &nbsp; ' . self::badge('low') . ' ' . (int) $c['low'] . '</p>';
            echo '<p class="agsc-meta">' . (int) $scan['scanned_products'] . ' of ' . (int) $scan['published_products'] . ' published products scanned on ' . esc_html($scan['created_utc']) . ' UTC. ' . self::label('OBSERVED') . '</p>';
        } else {
            echo '<p>No scan yet. Run one to check prices, images, weights, stock and policy pages.</p>';
        }
        echo self::scan_button('agsc-overview'); // phpcs:ignore
        echo '</section>';

        echo '<section class="agsc-panel"><h2>AI traffic, last 30 days</h2>';
        if (!$traffic['capture_enabled']) {
            echo '<p class="agsc-figure">Off</p><p>Recording is switched off, so nothing is being counted. <a href="' . esc_url(self::page_url('agsc-settings')) . '">Turn it on in Settings</a>.</p>';
        } else {
            echo '<p class="agsc-figure">' . (int) $traffic['total_hits'] . '<span> requests</span></p>';
            echo '<p class="agsc-meta">Self-declared AI user agents and AI referrers since ' . esc_html($traffic['since_utc']) . '. Unverified. AgentScope\'s own checks are not counted. ' . self::label('OBSERVED') . '</p>';
        }
        echo '</section>';

        echo '<section class="agsc-panel"><h2>AI visibility</h2><p class="agsc-figure">In the app</p><p>Mentions in AI answers are checked in the AgentScope app, not in this plugin. ' . self::label('UNAVAILABLE') . '</p></section>';
        echo '</div>';

        $findings = array_slice(self::open_findings($scan), 0, 5);
        if ($findings) {
            echo '<h2 class="agsc-h2">Fix first</h2><ol class="agsc-list">';
            foreach ($findings as $f) {
                echo '<li>' . self::badge($f['severity']) . ' ' . esc_html($f['title']) . '</li>';
            }
            echo '</ol><p><a href="' . esc_url(self::page_url('agsc-fixes')) . '">Open Fix Center</a></p>';
        }
    }

    private static function page_traffic() {
        $t = AGSC_Traffic::summary(30);
        echo '<h1 class="agsc-title">AI Traffic</h1>';
        echo '<p class="agsc-lead">' . esc_html($t['caveat']) . '</p>';
        if (!$t['capture_enabled']) {
            echo '<div class="agsc-empty"><p>Recording is off. Turn it on in <a href="' . esc_url(self::page_url('agsc-settings')) . '">Settings</a> to start counting. Past days cannot be recovered.</p></div>';
        }
        if (empty($t['sources'])) {
            echo '<div class="agsc-empty"><p>No matching requests recorded since ' . esc_html($t['since_utc']) . ' UTC.</p></div>';
            return;
        }
        echo '<h2 class="agsc-h2">By source ' . self::label('OBSERVED') . '</h2>';
        echo '<div class="agsc-table-wrap"><table class="agsc-table"><thead><tr><th>Source</th><th>Type</th><th>Confidence</th><th>Requests</th><th>Last seen (UTC)</th></tr></thead><tbody>';
        foreach ($t['sources'] as $row) {
            echo '<tr><td>' . esc_html($row['source']) . '</td><td>' . esc_html($row['category']) . '</td><td>' . esc_html($row['confidence']) . '</td><td>' . (int) $row['hits'] . '</td><td>' . esc_html($row['last_seen']) . '</td></tr>';
        }
        echo '</tbody></table></div>';

        echo '<h2 class="agsc-h2">By page type</h2>';
        echo '<div class="agsc-table-wrap"><table class="agsc-table"><thead><tr><th>Page type</th><th>Source</th><th>Type</th><th>HTTP</th><th>Requests</th></tr></thead><tbody>';
        foreach ($t['routes'] as $row) {
            echo '<tr><td>' . esc_html($row['route']) . '</td><td>' . esc_html($row['source']) . '</td><td>' . esc_html($row['category']) . '</td><td>' . (int) $row['http_status'] . '</td><td>' . (int) $row['hits'] . '</td></tr>';
        }
        echo '</tbody></table></div>';

        $max = 1;
        foreach ($t['daily'] as $row) {
            $max = max($max, (int) $row['hits']);
        }
        echo '<h2 class="agsc-h2">By day</h2><ul class="agsc-bars">';
        foreach ($t['daily'] as $row) {
            $width = (int) round(((int) $row['hits'] / $max) * 100);
            echo '<li><span class="agsc-bars-day">' . esc_html($row['day']) . '</span><span class="agsc-bars-track"><span class="agsc-bars-fill" style="width:' . $width . '%"></span></span><span class="agsc-bars-n">' . (int) $row['hits'] . '</span></li>';
        }
        echo '</ul>';
    }

    private static function page_readiness() {
        $scan = AGSC_Readiness::current();
        echo '<h1 class="agsc-title">Store Readiness</h1>';
        echo '<p class="agsc-lead">Read-only checks of product and policy fields that shoppers and AI agents rely on. AgentScope never edits products.</p>';
        echo self::scan_button('agsc-readiness'); // phpcs:ignore
        if ($scan['status'] !== 'complete') {
            echo '<div class="agsc-empty"><p>No scan yet. Run the first scan to see findings.</p></div>';
            return;
        }
        $cmp = isset($scan['comparison']) ? $scan['comparison'] : array();
        echo '<p class="agsc-meta">Scanned ' . (int) $scan['scanned_products'] . ' of ' . (int) $scan['published_products'] . ' published products on ' . esc_html($scan['created_utc']) . ' UTC in ' . (int) $scan['duration_ms'] . ' ms. ' . self::label('OBSERVED') . '</p>';
        if (!empty($cmp) && empty($cmp['first_run'])) {
            echo '<p class="agsc-meta">Since the scan of ' . esc_html((string) $cmp['previous_scan_utc']) . ' UTC: ' . count($cmp['resolved_ids']) . ' resolved, ' . count($cmp['new_ids']) . ' new, ' . count($cmp['recurred_ids']) . ' came back.</p>';
        }
        $findings = self::open_findings($scan);
        if (!$findings) {
            echo '<div class="agsc-empty"><p>No findings on the scanned products and pages.</p></div>';
            return;
        }
        echo '<div class="agsc-table-wrap"><table class="agsc-table"><thead><tr><th>Severity</th><th>Finding</th><th>Evidence</th><th>State</th><th>Basis</th></tr></thead><tbody>';
        foreach ($findings as $f) {
            echo '<tr><td>' . self::badge($f['severity']) . '</td><td>' . esc_html($f['title']) . '</td><td>' . esc_html($f['evidence']) . '</td><td>' . esc_html(isset($f['state']) ? $f['state'] : '') . '</td><td>' . esc_html($f['basis']) . '</td></tr>';
        }
        echo '</tbody></table></div>';
        echo '<p class="agsc-meta">' . esc_html($scan['limitations']) . '</p>';
    }

    private static function page_fixes() {
        $scan = AGSC_Readiness::current();
        echo '<h1 class="agsc-title">Fix Center</h1>';
        echo '<p class="agsc-lead">Each item says what was found and how to correct it. You make the change in WordPress, then rescan to confirm it is resolved. AgentScope does not change products for you.</p>';
        echo self::scan_button('agsc-fixes'); // phpcs:ignore
        $findings = self::open_findings($scan);
        if (!$findings) {
            echo '<div class="agsc-empty"><p>Nothing to fix from the last scan, or no scan has run yet.</p></div>';
            return;
        }
        foreach ($findings as $f) {
            echo '<article class="agsc-fix agsc-fix--' . esc_attr($f['severity']) . '">';
            echo '<h2>' . self::badge($f['severity']) . ' ' . esc_html($f['title']) . '</h2>';
            echo '<p><strong>Found:</strong> ' . esc_html($f['evidence']) . '</p>';
            echo '<p><strong>Fix:</strong> ' . esc_html($f['guidance']) . '</p>';
            if (!empty($f['edit_url'])) {
                echo '<p><a class="agsc-link" href="' . esc_url($f['edit_url']) . '">Open product editor</a></p>';
            }
            echo '</article>';
        }
    }

    private static function page_visibility() {
        echo '<h1 class="agsc-title">AI Visibility</h1>';
        echo '<div class="agsc-empty"><p>This plugin does not check whether AI assistants mention or recommend this store; the AgentScope app does that from real AI answers. Nothing here is estimated. ' . self::label('UNAVAILABLE') . '</p></div>';
    }

    private static function page_reports() {
        echo '<h1 class="agsc-title">Reports</h1>';
        echo '<p class="agsc-lead">Downloads contain observed data only. Cells that start with = + - or @ are escaped so spreadsheets do not run them as formulas.</p>';
        echo '<p><a class="agsc-btn" href="' . esc_url(self::export_url('findings')) . '">Download findings CSV</a> <a class="agsc-btn agsc-btn--ghost" href="' . esc_url(self::export_url('traffic')) . '">Download AI traffic CSV</a></p>';
        $history = AGSC_Readiness::history_brief();
        echo '<h2 class="agsc-h2">Scan history</h2>';
        if (!$history) {
            echo '<div class="agsc-empty"><p>No scans yet.</p></div>';
            return;
        }
        echo '<div class="agsc-table-wrap"><table class="agsc-table"><thead><tr><th>Scan (UTC)</th><th>Products</th><th>Findings</th><th>Critical</th><th>Warning</th><th>Review</th><th>Resolved</th><th>New</th></tr></thead><tbody>';
        foreach ($history as $row) {
            $c = $row['severity_counts'];
            echo '<tr><td>' . esc_html($row['created_utc']) . '</td><td>' . (int) $row['scanned_products'] . '</td><td>' . (int) $row['findings_count'] . '</td><td>' . (int) $c['high'] . '</td><td>' . (int) $c['medium'] . '</td><td>' . (int) $c['low'] . '</td><td>' . (int) $row['resolved_count'] . '</td><td>' . (int) $row['new_count'] . '</td></tr>';
        }
        echo '</tbody></table></div>';
    }

    private static function page_settings() {
        $s = AGSC_Settings::get();
        echo '<h1 class="agsc-title">Settings</h1>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="agsc-form">';
        echo '<input type="hidden" name="action" value="agsc_save_settings">';
        wp_nonce_field('agsc_save_settings');
        echo '<label class="agsc-check"><input type="checkbox" name="capture_enabled" value="1"' . checked($s['capture_enabled'], true, false) . '> Record AI traffic signals</label>';
        echo '<p class="agsc-help">Counts requests whose user agent or referrer names a known AI service. Stores daily totals only: no IP address, no full user agent, no page URL. AgentScope\'s own checks (X-AgentScope-Check header) are not counted.</p>';
        echo '<label class="agsc-field">Keep data for <input type="number" name="retention_days" min="7" max="365" value="' . (int) $s['retention_days'] . '"> days</label>';
        echo '<label class="agsc-check"><input type="checkbox" name="delete_on_uninstall" value="1"' . checked($s['delete_on_uninstall'], true, false) . '> Delete all AgentScope data when the plugin is deleted</label>';
        echo '<p class="agsc-help">Off by default, so deleting the plugin keeps your history.</p>';
        echo '<button type="submit" class="agsc-btn">Save settings</button></form>';

        AGSC_Sender::render_section();

        $until = get_option(AGSC_Traffic::LEGACY);
        $cleared = get_option(AGSC_Traffic::CLEARED);
        echo '<h2 class="agsc-h2" id="agsc-clear">Clear test data</h2><div class="agsc-form">';
        if (!$until) {
            echo '<p class="agsc-help agsc-help--flush">Nothing to clear: no totals were recorded before version 1.1.0 on this site.</p>';
        } elseif (is_array($cleared)) {
            echo '<p class="agsc-help agsc-help--flush">Cleared on ' . esc_html(gmdate('Y-m-d H:i', (int) $cleared['time'])) . ' UTC: ' . (int) $cleared['rows'] . ' daily totals up to ' . esc_html((string) $cleared['until']) . ' set to 0.</p>';
        } else {
            echo '<p class="agsc-help agsc-help--flush">Before version 1.1.0, AgentScope\'s own checks (which use AI bot user agents) were counted as AI traffic. This sets every total recorded up to ' . esc_html((string) $until) . ' to 0, including real visits on those days, which cannot be told apart. When connected, the corrected days are sent to the app. This cannot be undone.</p>';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            echo '<input type="hidden" name="action" value="agsc_clear_test_data">';
            wp_nonce_field('agsc_clear_test_data');
            echo '<label class="agsc-check"><input type="checkbox" name="confirm_clear" value="1"> I understand: set the totals up to ' . esc_html((string) $until) . ' to 0</label>';
            echo '<button type="submit" class="agsc-btn agsc-btn--danger">Clear test data</button></form>';
        }
        echo '</div>';

        $test = AGSC_Signals::self_test();
        echo '<h2 class="agsc-h2">Classifier self-test ' . self::label('SYNTHETIC') . '</h2>';
        echo '<p class="agsc-meta">' . (int) $test['passed'] . ' of ' . (int) $test['total'] . ' cases pass. ' . esc_html($test['limitations']) . '</p>';
    }
}
