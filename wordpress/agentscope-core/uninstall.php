<?php
/**
 * Runs only when the plugin is deleted from wp-admin.
 * Data is kept unless the admin turned on "Delete all AgentScope data" in Settings.
 */
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
wp_clear_scheduled_hook('agsc_daily_purge');
wp_clear_scheduled_hook('agsc_send_traffic');
delete_transient('agsc_recent_bots');
$agsc_settings = get_option('agsc_settings', array());
if (is_array($agsc_settings) && !empty($agsc_settings['delete_on_uninstall'])) {
    global $wpdb;
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}agsc_traffic"); // phpcs:ignore
    foreach (array('agsc_settings', 'agsc_db_version', 'agsc_version', 'agsc_scan_current', 'agsc_scan_history', 'agsc_remote', 'agsc_remote_last_result', 'agsc_legacy_until', 'agsc_test_data_cleared', 'agsc_clear_log') as $agsc_option) {
        delete_option($agsc_option);
    }
}
