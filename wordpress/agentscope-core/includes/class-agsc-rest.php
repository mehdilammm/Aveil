<?php
/**
 * Admin-only REST routes under agentscope-core/v1.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Rest {
    const NS = 'agentscope-core/v1';

    public static function init() {
        add_action('rest_api_init', array(__CLASS__, 'routes'));
    }

    public static function can_manage() {
        return current_user_can('manage_options');
    }

    public static function routes() {
        register_rest_route(self::NS, '/summary', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'summary'),
            'permission_callback' => array(__CLASS__, 'can_manage'),
        ));
        register_rest_route(self::NS, '/scan', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'scan'),
            'permission_callback' => array(__CLASS__, 'can_manage'),
        ));
        register_rest_route(self::NS, '/settings', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'settings'),
            'permission_callback' => array(__CLASS__, 'can_manage'),
            'args'                => array(
                'capture_enabled'     => array('type' => 'boolean', 'required' => false),
                'retention_days'      => array('type' => 'integer', 'required' => false, 'minimum' => 7, 'maximum' => 365),
                'delete_on_uninstall' => array('type' => 'boolean', 'required' => false),
            ),
        ));
        register_rest_route(self::NS, '/selftest', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'selftest'),
            'permission_callback' => array(__CLASS__, 'can_manage'),
        ));
    }

    public static function summary($request) {
        $days = (int) $request->get_param('days');
        $remote = AGSC_Sender::settings();
        $last = get_option(AGSC_Sender::LAST, array());
        return rest_ensure_response(array(
            'plugin_version' => AGSC_VERSION,
            'settings'       => AGSC_Settings::get(),
            'traffic'        => AGSC_Traffic::summary($days > 0 ? $days : 30),
            'app_connection' => array(
                'connected' => AGSC_Sender::is_configured($remote),
                'store_id'  => $remote['store_id'] !== '' ? $remote['store_id'] : null,
                'last_send' => isset($last['message']) ? array('message' => $last['message'], 'time_utc' => gmdate('Y-m-d H:i:s', (int) $last['time'])) : null,
            ),
            'readiness'      => AGSC_Readiness::current(),
            'scan_history'   => AGSC_Readiness::history_brief(),
            'ai_visibility'  => array('data_label' => 'UNAVAILABLE', 'message' => 'Checked in the AgentScope app, not in this plugin.'),
        ));
    }

    public static function scan($request) {
        return rest_ensure_response(AGSC_Readiness::run_and_save());
    }

    public static function settings($request) {
        $input = array();
        foreach (array('capture_enabled', 'retention_days', 'delete_on_uninstall') as $key) {
            if ($request->has_param($key)) {
                $input[$key] = $request->get_param($key);
            }
        }
        return rest_ensure_response(AGSC_Settings::update($input));
    }

    public static function selftest($request) {
        return rest_ensure_response(AGSC_Signals::self_test());
    }
}
