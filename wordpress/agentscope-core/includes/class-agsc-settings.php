<?php
/**
 * Plugin settings. Traffic capture is opt-in and off by default.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Settings {
    const OPTION = 'agsc_settings';

    public static function defaults() {
        return array(
            'capture_enabled'     => false,
            'retention_days'      => 30,
            'delete_on_uninstall' => false,
        );
    }

    public static function get() {
        $saved = get_option(self::OPTION, array());
        if (!is_array($saved)) {
            $saved = array();
        }
        $settings = array_merge(self::defaults(), $saved);
        $settings['capture_enabled'] = (bool) $settings['capture_enabled'];
        $settings['delete_on_uninstall'] = (bool) $settings['delete_on_uninstall'];
        $settings['retention_days'] = self::clamp_days($settings['retention_days']);
        return $settings;
    }

    /**
     * Updates only the known keys present in $input.
     */
    public static function update($input) {
        $settings = self::get();
        if (!is_array($input)) {
            return $settings;
        }
        if (array_key_exists('capture_enabled', $input)) {
            $settings['capture_enabled'] = rest_sanitize_boolean($input['capture_enabled']);
        }
        if (array_key_exists('delete_on_uninstall', $input)) {
            $settings['delete_on_uninstall'] = rest_sanitize_boolean($input['delete_on_uninstall']);
        }
        if (array_key_exists('retention_days', $input)) {
            $settings['retention_days'] = self::clamp_days($input['retention_days']);
        }
        update_option(self::OPTION, $settings);
        return $settings;
    }

    private static function clamp_days($value) {
        $days = (int) $value;
        if ($days < 7) {
            $days = 7;
        }
        if ($days > 365) {
            $days = 365;
        }
        return $days;
    }
}
