<?php
/**
 * AI bot identity (1.5.0). Only for requests whose user agent is a known AI bot (list below), never for people:
 * the time, IP address, full user agent, page path (no query string), method and status are kept in a local
 * table on `shutdown` (one INSERT, no network), then sent in signed batches by WP-Cron to the AgentScope app,
 * which checks the IP against the bot operators' published lists. Rows are deleted here after a successful send,
 * and at most 7 days after capture if they could not be sent. Off unless traffic capture is on and the plugin is
 * connected to the app. AgentScope's own checks are never recorded.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Bothits {
    const TABLE        = 'agsc_bot_hits';
    const CRON         = 'agsc_flush_bot_hits';
    const SCHEDULE     = 'agsc_every_15_minutes';
    const BATCH        = 500;
    const MAX_AGE_DAYS = 7;

    /** Bot name => user-agent token. Kept in line with the app's lib/bot-verify.ts (most specific first). */
    public static function bots() {
        return array(
            'OAI-SearchBot'    => '~(?:^|[^a-z0-9])OAI-SearchBot/~i',
            'ChatGPT-User'     => '~(?:^|[^a-z0-9])ChatGPT-User/~i',
            'GPTBot'           => '~(?:^|[^a-z0-9])GPTBot/~i',
            'Claude-SearchBot' => '~(?:^|[^a-z0-9])Claude-SearchBot/~i',
            'Claude-User'      => '~(?:^|[^a-z0-9])Claude-User/~i',
            'ClaudeBot'        => '~(?:^|[^a-z0-9])ClaudeBot/~i',
            'Perplexity-User'  => '~(?:^|[^a-z0-9])Perplexity-User/~i',
            'PerplexityBot'    => '~(?:^|[^a-z0-9])PerplexityBot/~i',
        );
    }

    /** Pure: the bot a user agent names, or null (a person's browser, any other client). */
    public static function match_bot($user_agent) {
        foreach (self::bots() as $name => $re) {
            if (preg_match($re, (string) $user_agent)) {
                return $name;
            }
        }
        return null;
    }

    /** Pure: the request path without its query string, at most 500 characters. */
    public static function path_only($uri) {
        $path = parse_url((string) $uri, PHP_URL_PATH);
        return is_string($path) && $path !== '' && $path[0] === '/' ? substr($path, 0, 500) : '/';
    }

    public static function table() {
        global $wpdb;
        return $wpdb->prefix . self::TABLE;
    }

    public static function install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        dbDelta("CREATE TABLE {$table} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  hit_id char(36) NOT NULL,
  seen_at datetime NOT NULL,
  bot varchar(40) NOT NULL,
  ip varchar(45) NOT NULL,
  user_agent varchar(500) NOT NULL,
  url_path varchar(500) NOT NULL,
  method varchar(4) NOT NULL,
  http_status smallint(5) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY hit_id (hit_id),
  KEY seen_at (seen_at)
) {$wpdb->get_charset_collate()};");
    }

    public static function init() {
        add_filter('cron_schedules', array(__CLASS__, 'schedules'));
        add_action(self::CRON, array(__CLASS__, 'flush'));
        if (!wp_next_scheduled(self::CRON)) {
            wp_schedule_event(time() + 5 * MINUTE_IN_SECONDS, self::SCHEDULE, self::CRON);
        }
    }

    public static function schedules($s) {
        $s[self::SCHEDULE] = array('interval' => 15 * MINUTE_IN_SECONDS, 'display' => 'Every 15 minutes (AgentScope)');
        return $s;
    }

    /** Deactivation: no more sends, and the stored IPs are deleted at once. */
    public static function deactivate() {
        global $wpdb;
        wp_clear_scheduled_hook(self::CRON);
        $wpdb->query('DELETE FROM ' . self::table()); // phpcs:ignore -- table name only.
    }

    /**
     * Called by AGSC_Traffic::record (capture on, front-end GET/HEAD, not an AgentScope check). One local INSERT.
     * Nothing is kept when the plugin is not connected, since it could never be sent and checked.
     */
    public static function record($user_agent, $method, $status) {
        $bot = self::match_bot($user_agent);
        if (!$bot || !AGSC_Sender::is_configured()) {
            return;
        }
        $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            return;
        }
        global $wpdb;
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
        $wpdb->insert(self::table(), array(
            'hit_id'      => wp_generate_uuid4(),
            'seen_at'     => gmdate('Y-m-d H:i:s'),
            'bot'         => $bot,
            'ip'          => $ip,
            'user_agent'  => substr((string) $user_agent, 0, 500),
            'url_path'    => self::path_only($uri),
            'method'      => $method === 'HEAD' ? 'HEAD' : 'GET',
            'http_status' => (int) $status,
        ), array('%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d'));
    }

    /** Pure: the JSON body of one batch (the format /api/ingest/bot-hits expects). */
    public static function payload($rows) {
        $hits = array();
        foreach ((array) $rows as $r) {
            $hits[] = array(
                'hit_id'      => (string) $r['hit_id'],
                'seen_at'     => gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $r['seen_at'] . ' UTC')),
                'ip'          => (string) $r['ip'],
                'user_agent'  => (string) $r['user_agent'],
                'url_path'    => (string) $r['url_path'],
                'method'      => (string) $r['method'],
                'http_status' => (int) $r['http_status'],
            );
        }
        return wp_json_encode(array('hits' => $hits));
    }

    /** The ingest URL on the connected app's host. */
    public static function endpoint($settings) {
        $host = wp_parse_url((string) $settings['endpoint'], PHP_URL_HOST);
        return $host ? 'https://' . $host . '/api/ingest/bot-hits' : '';
    }

    /** WP-Cron, every 15 minutes: drop rows older than 7 days, then send one batch and delete what was accepted. */
    public static function flush() {
        global $wpdb;
        $table = self::table();
        $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE seen_at < %s", gmdate('Y-m-d H:i:s', time() - self::MAX_AGE_DAYS * DAY_IN_SECONDS)));
        $s = AGSC_Sender::settings();
        if (!AGSC_Sender::is_configured($s)) {
            return 'Not connected.';
        }
        $rows = $wpdb->get_results($wpdb->prepare("SELECT id, hit_id, seen_at, ip, user_agent, url_path, method, http_status FROM {$table} ORDER BY id ASC LIMIT %d", self::BATCH), ARRAY_A);
        if (!$rows) {
            return 'Nothing to send.';
        }
        $body = self::payload($rows);
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
            return 'Send failed; kept for a later try (at most 7 days).';
        }
        $ids = array_map('intval', wp_list_pluck($rows, 'id'));
        $wpdb->query("DELETE FROM {$table} WHERE id IN (" . implode(',', $ids) . ')'); // phpcs:ignore -- integers only.
        return 'Sent ' . count($ids) . ' bot hits.';
    }
}
