<?php
/**
 * Product feed for AI shopping agents (1.8.0, G1). The AgentScope app builds the feed from the store's own products
 * and sends it signed (AGSC_Fixes, kind "feed"); this class only serves the stored files, read from their own
 * option on these three addresses, never on other page loads:
 *   /agentscope-feed/products.jsonl - Agentic Commerce Protocol feed (2026-04-17), one Product per line
 *   /agentscope-feed/metadata.json  - its FeedMetadata
 *   /agentscope-feed.csv            - the Google Merchant Center fields that overlap
 * No network calls. Serving a feed does not submit it anywhere; the merchant chooses where to send it.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Feed {
    const PATH_JSONL    = '/agentscope-feed/products.jsonl';
    const PATH_METADATA = '/agentscope-feed/metadata.json';
    const PATH_CSV      = '/agentscope-feed.csv';

    public static function init() {
        add_action('parse_request', array(__CLASS__, 'serve'), 0);
    }

    /** Pure: the request path relative to the site's home path ("/shop/agentscope-feed.csv" → "/agentscope-feed.csv"). */
    public static function relative_path($request_path, $home_path) {
        $home = rtrim((string) $home_path, '/');
        $path = (string) $request_path;
        if ($home !== '' && strpos($path, $home . '/') === 0) {
            $path = substr($path, strlen($home));
        }
        return $path;
    }

    /** Pure: what to answer for a path, from the stored feed: array(content type, body) or null (not ours). */
    public static function response($path, $data) {
        if (!is_array($data) || empty($data['jsonl'])) {
            return null;
        }
        if ($path === self::PATH_JSONL) {
            return array('application/jsonl; charset=utf-8', (string) $data['jsonl']);
        }
        if ($path === self::PATH_METADATA) {
            return array('application/json; charset=utf-8', (string) $data['metadata']);
        }
        if ($path === self::PATH_CSV && !empty($data['csv'])) {
            return array('text/csv; charset=utf-8', (string) $data['csv']);
        }
        return null;
    }

    public static function serve($wp) {
        $request = isset($_SERVER['REQUEST_URI']) ? (string) parse_url((string) wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH) : '';
        $path = self::relative_path($request, (string) parse_url(home_url('/'), PHP_URL_PATH));
        if ($path !== self::PATH_JSONL && $path !== self::PATH_METADATA && $path !== self::PATH_CSV) {
            return;
        }
        if (!AGSC_Fixes::of_kind('feed')) {
            return;
        }
        $answer = self::response($path, get_option(AGSC_Fixes::FEED_OPTION, null));
        if (!$answer) {
            return;
        }
        status_header(200);
        header('Content-Type: ' . $answer[0]);
        header('X-Content-Type-Options: nosniff');
        header('X-Robots-Tag: noindex');
        header('Cache-Control: public, max-age=300');
        echo $answer[1]; // phpcs:ignore WordPress.Security.EscapeOutput -- data files built by the app, served with their own content type.
        exit;
    }

    /** For the app's status call: when the feed was stored, how many products, the addresses. Null without a feed. */
    public static function status($feed_fixes) {
        $f = $feed_fixes ? reset($feed_fixes) : null;
        if (!$f) {
            return null;
        }
        return array(
            'updated_at' => (int) $f['applied_at'],
            'products'   => isset($f['products']) ? (int) $f['products'] : 0,
            'bytes'      => isset($f['bytes']) ? (int) $f['bytes'] : 0,
            'urls'       => array(
                'jsonl'    => home_url(self::PATH_JSONL),
                'metadata' => home_url(self::PATH_METADATA),
                'csv'      => home_url(self::PATH_CSV),
            ),
        );
    }
}
