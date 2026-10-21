<?php
/**
 * Sends the daily traffic totals from the agsc_traffic table to the AgentScope app, once a day.
 * Only the aggregated rows are sent (day, source, category, confidence, route, http_status, hits, last_seen).
 * No IP, user agent, URL or cookie leaves the site. Requests are signed with HMAC-SHA256.
 *
 * Install: copy this file to agentscope-core/includes/, then in agentscope-core.php add
 *   require_once AGSC_DIR . 'includes/class-agsc-sender.php';
 * after the other require_once lines, and inside agsc_bootstrap() add
 *   AGSC_Sender::init();
 * Also add to the deactivation hook list:
 *   register_deactivation_hook(__FILE__, array('AGSC_Sender', 'deactivate'));
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Sender {
    const OPTION    = 'agsc_remote';
    const CRON      = 'agsc_send_traffic';
    const LAST      = 'agsc_remote_last_result';
    const SEND_DAYS = 3; // Resend the last 3 days: totals are replaced, so late hits are corrected.

    public static function init() {
        add_action(self::CRON, array(__CLASS__, 'send'));
        add_action('admin_menu', array(__CLASS__, 'menu'), 20);
        add_action('admin_post_agsc_save_remote', array(__CLASS__, 'handle_save'));
        add_action('admin_post_agsc_send_now', array(__CLASS__, 'handle_send_now'));
        if (!wp_next_scheduled(self::CRON)) {
            wp_schedule_event(time() + 15 * MINUTE_IN_SECONDS, 'daily', self::CRON);
        }
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON);
    }

    public static function settings() {
        $saved = get_option(self::OPTION, array());
        return array_merge(array('endpoint' => '', 'store_id' => '', 'token' => ''), is_array($saved) ? $saved : array());
    }

    private static function is_configured($s) {
        return strpos($s['endpoint'], 'https://') === 0
            && preg_match('/^[0-9a-f-]{36}$/i', $s['store_id'])
            && strpos($s['token'], 'agsc_') === 0;
    }

    /** Collects the last SEND_DAYS days of totals and posts them. Returns a short result string. */
    public static function send() {
        global $wpdb;
        $s = self::settings();
        if (!self::is_configured($s)) {
            return self::remember('Not configured.');
        }

        $table = AGSC_Traffic::table();
        $since = gmdate('Y-m-d', time() - (self::SEND_DAYS - 1) * DAY_IN_SECONDS);
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT day, source, category, confidence, route, http_status, hits, last_seen FROM {$table} WHERE day >= %s ORDER BY day ASC LIMIT 1000",
            $since
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

    public static function menu() {
        add_submenu_page('agsc-overview', 'Connect app - AgentScope', 'Connect app', 'manage_options', 'agsc-connect', array(__CLASS__, 'render'));
    }

    public static function handle_save() {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.', 403);
        }
        check_admin_referer('agsc_save_remote');
        $current = self::settings();
        $token = isset($_POST['token']) ? trim(sanitize_text_field(wp_unslash($_POST['token']))) : '';
        update_option(self::OPTION, array(
            'endpoint' => isset($_POST['endpoint']) ? esc_url_raw(trim(wp_unslash($_POST['endpoint'])), array('https')) : '',
            'store_id' => isset($_POST['store_id']) ? sanitize_text_field(wp_unslash($_POST['store_id'])) : '',
            // An empty field keeps the saved token, so it never has to be shown again.
            'token'    => $token !== '' ? $token : $current['token'],
        ), false);
        wp_safe_redirect(admin_url('admin.php?page=agsc-connect&saved=1'));
        exit;
    }

    public static function handle_send_now() {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.', 403);
        }
        check_admin_referer('agsc_send_now');
        self::send();
        wp_safe_redirect(admin_url('admin.php?page=agsc-connect'));
        exit;
    }

    public static function render() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = self::settings();
        $last = get_option(self::LAST, array());
        $next = wp_next_scheduled(self::CRON);
        ?>
        <div class="wrap">
            <h1>Connect to the AgentScope app</h1>
            <p>Sends the daily AI traffic totals (no IPs, user agents, URLs or cookies) once a day. Create the token in the app under Settings → AI traffic plugin.</p>
            <?php if (!empty($_GET['saved'])) : ?><div class="notice notice-success"><p>Saved.</p></div><?php endif; ?>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="agsc_save_remote">
                <?php wp_nonce_field('agsc_save_remote'); ?>
                <table class="form-table" role="presentation">
                    <tr><th><label for="agsc-endpoint">Endpoint</label></th>
                        <td><input id="agsc-endpoint" name="endpoint" type="url" class="regular-text" value="<?php echo esc_attr($s['endpoint']); ?>" placeholder="https://your-app/api/ingest/traffic"></td></tr>
                    <tr><th><label for="agsc-store">Store ID</label></th>
                        <td><input id="agsc-store" name="store_id" type="text" class="regular-text" value="<?php echo esc_attr($s['store_id']); ?>"></td></tr>
                    <tr><th><label for="agsc-token">Token</label></th>
                        <td><input id="agsc-token" name="token" type="password" class="regular-text" autocomplete="off" placeholder="<?php echo $s['token'] ? esc_attr('Saved (…' . substr($s['token'], -4) . '). Leave empty to keep it.') : 'agsc_…'; ?>"></td></tr>
                </table>
                <?php submit_button('Save'); ?>
            </form>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="agsc_send_now">
                <?php wp_nonce_field('agsc_send_now'); ?>
                <?php submit_button('Send now', 'secondary'); ?>
            </form>
            <p>Last result: <?php echo isset($last['message']) ? esc_html($last['message'] . ' (' . gmdate('Y-m-d H:i', (int) $last['time']) . ' UTC)') : 'none yet'; ?></p>
            <p>Next automatic send: <?php echo $next ? esc_html(gmdate('Y-m-d H:i', $next) . ' UTC') : 'not scheduled'; ?></p>
        </div>
        <?php
    }
}
