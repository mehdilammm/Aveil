<?php
/**
 * Store changes (1.7.0). When a plugin, theme or WordPress itself is updated, a theme is switched, a plugin is
 * turned on or off, or a product is published or updated, a short note is kept in a local option: what changed
 * (name, old and new version, product id) and when. No visitor, customer or order data. Nothing is sent during
 * the request: WP-Cron sends the notes to the AgentScope app in one signed request (HMAC + timestamp), which then
 * re-checks the store (breakage alert) or the product (instant check). Only while the plugin is connected.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Events {
    const QUEUE        = 'agsc_event_queue';
    const DEBOUNCE     = 'agsc_product_debounce';
    const PENDING      = 'agsc_upgrade_old_versions';
    const CRON         = 'agsc_send_events';
    const MAX_QUEUE    = 50;
    const MAX_AGE_DAYS = 7;
    const PRODUCT_GAP  = 300; // a product is reported at most once every 5 minutes

    public static function init() {
        add_action(self::CRON, array(__CLASS__, 'flush'));
        add_filter('upgrader_pre_install', array(__CLASS__, 'before_install'), 10, 2);
        add_action('upgrader_process_complete', array(__CLASS__, 'after_upgrade'), 10, 2);
        add_action('switch_theme', array(__CLASS__, 'theme_switched'), 10, 3);
        add_action('activated_plugin', array(__CLASS__, 'plugin_activated'));
        add_action('deactivated_plugin', array(__CLASS__, 'plugin_deactivated'));
        add_action('transition_post_status', array(__CLASS__, 'post_status'), 10, 3);
        add_action('woocommerce_update_product', array(__CLASS__, 'product_updated'));
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON);
        delete_option(self::QUEUE);
        delete_option(self::DEBOUNCE);
        delete_option(self::PENDING);
    }

    /** Pure: one event as the app expects it. */
    public static function event($kind, $subject = null, $slug = null, $old = null, $new = null, $product_id = null, $now = null) {
        $clip = function ($v, $n) {
            return $v === null || $v === '' ? null : substr(wp_strip_all_tags((string) $v), 0, $n);
        };
        return array(
            'id'          => wp_generate_uuid4(),
            'kind'        => (string) $kind,
            'subject'     => $clip($subject, 200),
            'slug'        => $clip($slug, 200),
            'old_version' => $clip($old, 40),
            'new_version' => $clip($new, 40),
            'product_id'  => $product_id ? (int) $product_id : null,
            'at'          => gmdate('Y-m-d\TH:i:s\Z', $now ? (int) $now : time()),
        );
    }

    /** Adds events to the local queue (an option) and asks WP-Cron to send it within a minute. No network here. */
    public static function queue($events) {
        if (!AGSC_Sender::is_configured() || !$events) {
            return;
        }
        $q = get_option(self::QUEUE, array());
        $q = is_array($q) ? $q : array();
        foreach ($events as $e) {
            $q[] = $e;
        }
        $cutoff = gmdate('Y-m-d\TH:i:s\Z', time() - self::MAX_AGE_DAYS * DAY_IN_SECONDS);
        $q = array_values(array_filter($q, function ($e) use ($cutoff) {
            return isset($e['at']) && $e['at'] >= $cutoff;
        }));
        $q = array_slice($q, -self::MAX_QUEUE);
        update_option(self::QUEUE, $q, false);
        if (!wp_next_scheduled(self::CRON)) {
            wp_schedule_single_event(time() + MINUTE_IN_SECONDS, self::CRON);
        }
    }

    private static function plugin_info($file) {
        $path = WP_PLUGIN_DIR . '/' . $file;
        if (!is_readable($path)) {
            return array('name' => $file, 'version' => null);
        }
        if (!function_exists('get_plugin_data')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $d = get_plugin_data($path, false, false);
        return array('name' => $d['Name'] ? $d['Name'] : $file, 'version' => $d['Version'] ? $d['Version'] : null);
    }

    /** Before an update is installed: remember the version that is about to be replaced (local file read). */
    public static function before_install($response, $hook_extra) {
        $pending = get_option(self::PENDING, array());
        $pending = is_array($pending) ? $pending : array();
        if (!empty($hook_extra['plugin'])) {
            $pending['plugin:' . $hook_extra['plugin']] = self::plugin_info($hook_extra['plugin'])['version'];
        } elseif (!empty($hook_extra['theme'])) {
            $t = wp_get_theme($hook_extra['theme']);
            $pending['theme:' . $hook_extra['theme']] = $t->exists() ? $t->get('Version') : null;
        }
        update_option(self::PENDING, $pending, false);
        return $response;
    }

    /** Pure: the WordPress version written in a version.php file's contents. */
    public static function core_version_in($php) {
        return preg_match('/\$wp_version\s*=\s*\'([^\']+)\'/', (string) $php, $m) ? $m[1] : null;
    }

    public static function after_upgrade($upgrader, $hook_extra) {
        $type = isset($hook_extra['type']) ? $hook_extra['type'] : '';
        $pending = get_option(self::PENDING, array());
        $pending = is_array($pending) ? $pending : array();
        $events = array();
        if ($type === 'plugin') {
            $files = !empty($hook_extra['plugins']) ? (array) $hook_extra['plugins'] : (!empty($hook_extra['plugin']) ? array($hook_extra['plugin']) : array());
            foreach ($files as $file) {
                $info = self::plugin_info($file);
                $events[] = self::event('plugin_updated', $info['name'], $file, isset($pending['plugin:' . $file]) ? $pending['plugin:' . $file] : null, $info['version']);
                unset($pending['plugin:' . $file]);
            }
        } elseif ($type === 'theme') {
            $slugs = !empty($hook_extra['themes']) ? (array) $hook_extra['themes'] : (!empty($hook_extra['theme']) ? array($hook_extra['theme']) : array());
            foreach ($slugs as $slug) {
                $t = wp_get_theme($slug);
                $events[] = self::event('theme_updated', $t->exists() ? $t->get('Name') : $slug, $slug, isset($pending['theme:' . $slug]) ? $pending['theme:' . $slug] : null, $t->exists() ? $t->get('Version') : null);
                unset($pending['theme:' . $slug]);
            }
        } elseif ($type === 'core') {
            global $wp_version;
            $file = ABSPATH . WPINC . '/version.php';
            $new = is_readable($file) ? self::core_version_in(file_get_contents($file)) : null; // local file
            $events[] = self::event('core_updated', 'WordPress', 'core', $wp_version, $new);
        }
        update_option(self::PENDING, $pending, false);
        self::queue($events);
    }

    public static function theme_switched($new_name, $new_theme = null, $old_theme = null) {
        $old = $old_theme && method_exists($old_theme, 'get') ? $old_theme->get('Name') : '';
        $slug = $new_theme && method_exists($new_theme, 'get_stylesheet') ? $new_theme->get_stylesheet() : null;
        $version = $new_theme && method_exists($new_theme, 'get') ? $new_theme->get('Version') : null;
        self::queue(array(self::event('theme_switched', ($old ? $old . ' → ' : '') . $new_name, $slug, null, $version)));
    }

    public static function plugin_activated($file) {
        $info = self::plugin_info($file);
        self::queue(array(self::event('plugin_activated', $info['name'], $file, null, $info['version'])));
    }

    public static function plugin_deactivated($file) {
        if ($file === plugin_basename(AGSC_FILE)) {
            return; // our own deactivation clears the queue instead
        }
        $info = self::plugin_info($file);
        self::queue(array(self::event('plugin_deactivated', $info['name'], $file, $info['version'], null)));
    }

    /** Pure: whether a product may be reported now (at most once every 5 minutes); returns the new map. */
    public static function debounce($map, $product_id, $now) {
        $map = is_array($map) ? $map : array();
        foreach ($map as $id => $t) {
            if ($now - (int) $t > self::PRODUCT_GAP) {
                unset($map[$id]);
            }
        }
        if (isset($map[$product_id])) {
            return array(false, $map);
        }
        $map[$product_id] = $now;
        return array(true, $map);
    }

    private static function product_event($kind, $product_id) {
        list($ok, $map) = self::debounce(get_option(self::DEBOUNCE, array()), (int) $product_id, time());
        update_option(self::DEBOUNCE, $map, false);
        if ($ok) {
            self::queue(array(self::event($kind, get_the_title($product_id), null, null, null, $product_id)));
        }
    }

    public static function post_status($new_status, $old_status, $post) {
        if ($post && $post->post_type === 'product' && $new_status === 'publish' && $old_status !== 'publish') {
            self::product_event('product_published', $post->ID);
        }
    }

    public static function product_updated($product_id) {
        if (get_post_status($product_id) === 'publish') {
            self::product_event('product_updated', $product_id);
        }
    }

    /** The events URL on the connected app's host. */
    public static function endpoint($settings) {
        $host = wp_parse_url((string) $settings['endpoint'], PHP_URL_HOST);
        return $host ? 'https://' . $host . '/api/ingest/events' : '';
    }

    /** WP-Cron: send the queue in one signed request; remove what the app accepted, keep the rest for a retry. */
    public static function flush() {
        $s = AGSC_Sender::settings();
        $q = get_option(self::QUEUE, array());
        if (!AGSC_Sender::is_configured($s) || !is_array($q) || !$q) {
            return 'Nothing to send.';
        }
        $batch = array_slice($q, 0, self::MAX_QUEUE);
        $body = wp_json_encode(array('events' => $batch));
        $timestamp = (string) time();
        $response = wp_remote_post(self::endpoint($s), array(
            'timeout' => 20,
            'headers' => array(
                'Content-Type'           => 'application/json',
                'X-AgentScope-Store'     => $s['store_id'],
                'X-AgentScope-Timestamp' => $timestamp,
                'X-AgentScope-Signature' => 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $s['token']),
            ),
            'body'    => $body,
        ));
        if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) {
            if (!wp_next_scheduled(self::CRON)) {
                wp_schedule_single_event(time() + 15 * MINUTE_IN_SECONDS, self::CRON);
            }
            return 'Send failed; kept for a later try (at most 7 days).';
        }
        $sent = wp_list_pluck($batch, 'id');
        $left = array_values(array_filter(get_option(self::QUEUE, array()), function ($e) use ($sent) {
            return !in_array($e['id'], $sent, true);
        }));
        update_option(self::QUEUE, $left, false);
        return 'Sent ' . count($sent) . ' store changes.';
    }
}
