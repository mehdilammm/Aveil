<?php
/**
 * Update checker without a library: a daily WP-Cron event asks the AgentScope app for the latest version; the
 * update filters only read that cached answer, so no admin page or visitor page ever waits for a network call.
 * The update shows in WordPress like any plugin update, and the zip's SHA-256 is checked before it is installed.
 *
 * The request is a plain GET of /api/plugin/latest. It sends no store data: no site URL (the user agent is
 * "AgentScope-Core/<version>"), no token, no traffic. The app is the one the plugin is connected to, else the default.
 * Not part of a WordPress.org build: there updates come from WordPress.org (leave this file out of that zip).
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Updater {
    const DEFAULT_URL = 'https://agentscope-peach.vercel.app/api/plugin/latest';
    const CACHE       = 'agsc_update_info';
    const SLUG        = 'agentscope-core';
    const CRON        = 'agsc_check_update';

    public static function init() {
        add_action(self::CRON, array(__CLASS__, 'refresh'));
        if (!wp_next_scheduled(self::CRON)) {
            wp_schedule_event(time() + 10 * MINUTE_IN_SECONDS, 'daily', self::CRON);
        }
        add_filter('pre_set_site_transient_update_plugins', array(__CLASS__, 'inject_update'));
        add_filter('plugins_api', array(__CLASS__, 'plugin_info'), 10, 3);
        add_filter('upgrader_pre_download', array(__CLASS__, 'verified_download'), 10, 3);
    }

    /** The app's latest-version URL: same host as the connected app, else the default. */
    public static function endpoint() {
        $remote = AGSC_Sender::settings();
        $host = $remote['endpoint'] ? wp_parse_url($remote['endpoint'], PHP_URL_HOST) : '';
        return $host ? 'https://' . $host . '/api/plugin/latest' : self::DEFAULT_URL;
    }

    /**
     * Pure check of the app's answer (tested from the command line): a version, an https zip on the same host as
     * the endpoint, a 64-character SHA-256. Returns the cleaned info, or null.
     */
    public static function parse_latest($body, $endpoint_host) {
        $data = json_decode((string) $body, true);
        if (!is_array($data) || !isset($data['version'], $data['download_url'], $data['sha256'])) {
            return null;
        }
        $version = (string) $data['version'];
        $url = (string) $data['download_url'];
        $sha = strtolower((string) $data['sha256']);
        $parts = parse_url($url);
        if (!preg_match('/^\d+\.\d+\.\d+$/', $version) || !preg_match('/^[0-9a-f]{64}$/', $sha)) {
            return null;
        }
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || strtolower($parts['host'] ?? '') !== strtolower((string) $endpoint_host)) {
            return null;
        }
        if (!preg_match('~^/downloads/agentscope-core-[0-9.]+\.zip$~', $parts['path'] ?? '')) {
            return null;
        }
        return array(
            'version'      => $version,
            'download_url' => $url,
            'sha256'       => $sha,
            'changelog'    => isset($data['changelog']) && is_array($data['changelog']) ? array_slice(array_map('strval', $data['changelog']), 0, 20) : array(),
            'requires'     => isset($data['requires']) ? (string) $data['requires'] : '',
            'requires_php' => isset($data['requires_php']) ? (string) $data['requires_php'] : '',
            'tested'       => isset($data['tested']) ? (string) $data['tested'] : '',
        );
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON);
    }

    /** Cached latest info only: never a network call (the cache is filled by the daily WP-Cron event). */
    public static function latest() {
        $cached = get_option(self::CACHE);
        return is_array($cached) && isset($cached['version']) ? $cached : null;
    }

    /** WP-Cron: asks the app once a day and caches the answer (a failed check keeps the previous answer). */
    public static function refresh() {
        $url = self::endpoint();
        $response = wp_remote_get($url, array(
            'timeout'    => 10,
            'user-agent' => 'AgentScope-Core/' . AGSC_VERSION,
            'headers'    => array('Accept' => 'application/json'),
        ));
        $info = null;
        if (!is_wp_error($response) && (int) wp_remote_retrieve_response_code($response) === 200) {
            $info = self::parse_latest(wp_remote_retrieve_body($response), wp_parse_url($url, PHP_URL_HOST));
        }
        if ($info) {
            update_option(self::CACHE, $info, false);
            // WordPress rebuilds its update list from the filter on its next check.
            delete_site_transient('update_plugins');
        }
        return $info;
    }

    private static function basename() {
        return plugin_basename(AGSC_FILE);
    }

    public static function inject_update($transient) {
        if (!is_object($transient)) {
            return $transient;
        }
        $info = self::latest();
        if (!$info || !version_compare($info['version'], AGSC_VERSION, '>')) {
            return $transient;
        }
        $transient->response[self::basename()] = (object) array(
            'slug'         => self::SLUG,
            'plugin'       => self::basename(),
            'new_version'  => $info['version'],
            'package'      => $info['download_url'],
            'url'          => 'https://' . wp_parse_url($info['download_url'], PHP_URL_HOST) . '/',
            'tested'       => $info['tested'],
            'requires_php' => $info['requires_php'],
        );
        return $transient;
    }

    public static function plugin_info($result, $action, $args) {
        if ($action !== 'plugin_information' || !is_object($args) || !isset($args->slug) || $args->slug !== self::SLUG) {
            return $result;
        }
        $info = self::latest();
        if (!$info) {
            return $result;
        }
        $changes = '<ul>';
        foreach ($info['changelog'] as $line) {
            $changes .= '<li>' . esc_html($line) . '</li>';
        }
        $changes .= '</ul>';
        return (object) array(
            'name'          => 'AgentScope Core',
            'slug'          => self::SLUG,
            'version'       => $info['version'],
            'author'        => 'AgentScope',
            'requires'      => $info['requires'],
            'requires_php'  => $info['requires_php'],
            'tested'        => $info['tested'],
            'download_link' => $info['download_url'],
            'sections'      => array(
                'description' => 'Read-only WooCommerce readiness checks and opt-in AI traffic signals.',
                'changelog'   => $changes,
            ),
        );
    }

    /** Downloads our package itself and refuses it unless its SHA-256 matches the one the app published. */
    public static function verified_download($reply, $package, $upgrader) {
        $info = self::latest();
        if ($reply !== false || !$info || $package !== $info['download_url']) {
            return $reply;
        }
        if (!function_exists('download_url')) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
        }
        $file = download_url($package, 60);
        if (is_wp_error($file)) {
            return $file;
        }
        if (!hash_equals($info['sha256'], (string) hash_file('sha256', $file))) {
            wp_delete_file($file);
            delete_option(self::CACHE);
            return new WP_Error('agsc_checksum', 'The AgentScope Core update did not match its published SHA-256 checksum, so it was not installed.');
        }
        return $file;
    }
}
