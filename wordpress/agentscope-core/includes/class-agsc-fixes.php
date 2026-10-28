<?php
/**
 * Technical fixes applied by AgentScope (1.6.0), only from requests signed by the AgentScope app.
 *
 * The app sends POST /wp-json/agentscope-core/v1/fixes with
 *   X-AgentScope-Timestamp: unix seconds (accepted within 5 minutes),
 *   X-AgentScope-Nonce:     32 hex characters, used once (kept 10 minutes),
 *   X-AgentScope-Signature: sha256=<hex HMAC-SHA256(connection token, "<timestamp>.<nonce>.<body>")>.
 * The body is {"action": "apply" | "revert" | "status", "fixes": [...]}. Fixes are stored in one option and read on
 * page load (no network, no extra query beyond that autoloaded option):
 *   jsonld   - extends the product's existing Product node (WooCommerce, Yoast or Rank Math) with fields that come
 *              from the store's own data: the product's brand, or the store's name when it has none. Same @id,
 *              never a second Product.
 *   llms_txt - serves /llms.txt with the text the app generated from the store's data, unless a real file exists.
 *   robots   - adds the AgentScope AI-agent groups to WordPress's virtual robots.txt (no effect when a robots.txt
 *              file exists; the app reports that and offers the copyable patch instead).
 *   feed     - (1.8.0) the product feed the app built from the store's products: ACP metadata.json and products.jsonl,
 *              and a CSV with the Google Merchant fields, served by AGSC_Feed. The files are kept in their own option
 *              (not autoloaded), so ordinary page loads never read them.
 *   org, shipping, website, breadcrumbs, variants, returns - (1.8.0) structured data parts, see AGSC_Schema; each
 *              keeps a small, checked payload.
 * Administrators see the applied fixes in Settings and can remove each one (capability check + nonce).
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Fixes {
    const OPTION   = 'agsc_fixes';
    const NONCES   = 'agsc_fix_nonces';
    const MAX_SKEW = 300;
    const KINDS    = array('jsonld', 'llms_txt', 'robots', 'feed', 'org', 'shipping', 'website', 'breadcrumbs', 'variants', 'returns');
    const MAX_TEXT = 100000;
    const FEED_OPTION = 'agsc_feed_data';
    const MAX_FEED    = 4194304; // 4 MB per file

    public static function init() {
        add_action('rest_api_init', array(__CLASS__, 'routes'));
        add_filter('woocommerce_structured_data_product', array(__CLASS__, 'extend_wc'), 20, 2);
        add_filter('wpseo_schema_product', array(__CLASS__, 'extend_graph_node'), 20, 1);
        add_filter('rank_math/snippet/rich_snippet_product_entity', array(__CLASS__, 'extend_graph_node'), 20, 1);
        add_filter('robots_txt', array(__CLASS__, 'robots'), 20, 2);
        add_action('parse_request', array(__CLASS__, 'serve_llms_txt'), 0);
        add_action('admin_post_agsc_remove_fix', array(__CLASS__, 'handle_remove'));
    }

    public static function all() {
        $fixes = get_option(self::OPTION, array());
        return is_array($fixes) ? $fixes : array();
    }

    // ---- Signed requests -------------------------------------------------------------------------------------

    public static function routes() {
        register_rest_route('agentscope-core/v1', '/fixes', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'handle'),
            'permission_callback' => array(__CLASS__, 'signed'),
        ));
    }

    /** Pure: the signature check (tested from the command line). */
    public static function verify($token, $timestamp, $nonce, $body, $signature, $now) {
        if ($token === '' || !preg_match('/^\d{9,11}$/', (string) $timestamp) || !preg_match('/^[0-9a-f]{32}$/', (string) $nonce)) {
            return false;
        }
        if (abs((int) $now - (int) $timestamp) > self::MAX_SKEW) {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $nonce . '.' . $body, $token);
        return hash_equals($expected, (string) $signature);
    }

    /** permission_callback: a valid signature with a nonce never seen before. */
    public static function signed($request) {
        $s = AGSC_Sender::settings();
        if (!AGSC_Sender::is_configured($s)) {
            return false;
        }
        $ts = (string) $request->get_header('x_agentscope_timestamp');
        $nonce = (string) $request->get_header('x_agentscope_nonce');
        if (!self::verify($s['token'], $ts, $nonce, (string) $request->get_body(), (string) $request->get_header('x_agentscope_signature'), time())) {
            return false;
        }
        return self::use_nonce($nonce, time());
    }

    /** Remembers nonces for 10 minutes; a nonce seen before is refused (replay). */
    public static function use_nonce($nonce, $now) {
        $seen = get_option(self::NONCES, array());
        $seen = is_array($seen) ? array_filter($seen, function ($t) use ($now) { return $t > $now - 2 * self::MAX_SKEW; }) : array();
        if (isset($seen[$nonce])) {
            return false;
        }
        $seen[$nonce] = $now;
        update_option(self::NONCES, $seen, false);
        return true;
    }

    /** Pure: keeps only well-formed fixes of known kinds. */
    public static function clean($fix) {
        if (!is_array($fix) || !isset($fix['id'], $fix['kind']) || !preg_match('/^[0-9a-f-]{36}$/', (string) $fix['id']) || !in_array($fix['kind'], self::KINDS, true)) {
            return null;
        }
        $p = isset($fix['payload']) && is_array($fix['payload']) ? $fix['payload'] : array();
        $out = array('id' => (string) $fix['id'], 'kind' => $fix['kind'], 'applied_at' => time());
        if (in_array($fix['kind'], AGSC_Schema::KINDS, true)) {
            $payload = AGSC_Schema::clean_payload($fix['kind'], $p);
            if ($payload === null) {
                return null;
            }
            $out['payload'] = $payload;
            return $out;
        }
        if ($fix['kind'] === 'feed') {
            $data = self::clean_feed($p);
            if (!$data) {
                return null;
            }
            $out['products'] = $data['products'];
            $out['bytes'] = strlen($data['metadata']) + strlen($data['jsonl']) + strlen($data['csv']);
            $out['data'] = $data; // moved to its own option by handle()
            return $out;
        }
        if ($fix['kind'] === 'jsonld') {
            $pid = isset($fix['target']) ? (int) $fix['target'] : 0;
            if ($pid <= 0) {
                return null;
            }
            $out['target'] = $pid;
            $out['brand_fallback'] = isset($p['brand_fallback']) ? substr(sanitize_text_field((string) $p['brand_fallback']), 0, 120) : '';
        } else {
            $text = isset($p['text']) ? (string) $p['text'] : '';
            if ($text === '' || strlen($text) > self::MAX_TEXT) {
                return null;
            }
            $out['text'] = str_replace("\r", '', $text);
        }
        return $out;
    }

    /** Pure: a feed payload with metadata JSON (with an id), JSON lines that are each a product with variants, a CSV. */
    public static function clean_feed($p) {
        $metadata = isset($p['metadata']) ? (string) $p['metadata'] : '';
        $jsonl = isset($p['jsonl']) ? str_replace("\r", '', (string) $p['jsonl']) : '';
        $csv = isset($p['csv']) ? (string) $p['csv'] : '';
        if ($metadata === '' || strlen($metadata) > 4096 || $jsonl === '' || strlen($jsonl) > self::MAX_FEED || strlen($csv) > self::MAX_FEED || strpos($csv, 'id,') !== 0) {
            return null;
        }
        $meta = json_decode($metadata, true);
        if (!is_array($meta) || empty($meta['id']) || !is_string($meta['id'])) {
            return null;
        }
        $count = 0;
        foreach (explode("\n", $jsonl) as $line) {
            if (trim($line) === '') {
                continue;
            }
            $product = json_decode($line, true);
            if (!is_array($product) || !isset($product['id']) || !is_string($product['id']) || !isset($product['variants']) || !is_array($product['variants'])) {
                return null;
            }
            $count++;
        }
        return $count ? array('metadata' => $metadata, 'jsonl' => $jsonl, 'csv' => $csv, 'products' => $count, 'stored_at' => time()) : null;
    }

    public static function handle($request) {
        $data = json_decode((string) $request->get_body(), true);
        $action = is_array($data) && isset($data['action']) ? (string) $data['action'] : '';
        $fixes = self::all();
        $done = array();
        if ($action === 'apply') {
            foreach ((array) ($data['fixes'] ?? array()) as $raw) {
                $fix = self::clean($raw);
                if ($fix) {
                    $before = isset($fixes[$fix['id']]) ? $fixes[$fix['id']] : null;
                    if ($fix['kind'] === 'feed' || in_array($fix['kind'], AGSC_Schema::KINDS, true)) {
                        // One feed and one of each structured data part per store: a new one replaces the old one.
                        foreach ($fixes as $id => $f) {
                            if ($f['kind'] === $fix['kind'] && $id !== $fix['id']) {
                                unset($fixes[$id]);
                            }
                        }
                    }
                    if ($fix['kind'] === 'feed') {
                        update_option(self::FEED_OPTION, $fix['data'], false);
                        unset($fix['data']);
                    }
                    $fixes[$fix['id']] = $fix;
                    $done[] = array('id' => $fix['id'], 'before' => $before);
                }
            }
            update_option(self::OPTION, $fixes, true);
        } elseif ($action === 'revert') {
            foreach ((array) ($data['ids'] ?? array()) as $id) {
                $id = (string) $id;
                if (isset($fixes[$id])) {
                    if ($fixes[$id]['kind'] === 'feed') {
                        delete_option(self::FEED_OPTION);
                    }
                    unset($fixes[$id]);
                    $done[] = array('id' => $id);
                }
            }
            update_option(self::OPTION, $fixes, true);
        } elseif ($action !== 'status') {
            return new WP_Error('agsc_bad_action', 'Unknown action.', array('status' => 400));
        }
        return rest_ensure_response(array(
            'plugin_version' => AGSC_VERSION,
            'done'           => $done,
            'applied'        => array_values(array_map(function ($f) { return array('id' => $f['id'], 'kind' => $f['kind'], 'target' => isset($f['target']) ? $f['target'] : null); }, $fixes)),
            'environment'    => array(
                'robots_file' => file_exists(ABSPATH . 'robots.txt'),
                'llms_file'   => file_exists(ABSPATH . 'llms.txt'),
                'woocommerce' => class_exists('WooCommerce'),
            ),
            'feed'           => AGSC_Feed::status(self::of_kind('feed')),
        ));
    }

    // ---- What the fixes do ----------------------------------------------------------------------------------

    public static function of_kind($kind) {
        return array_filter(self::all(), function ($f) use ($kind) { return $f['kind'] === $kind; });
    }

    private static function jsonld_for($product_id) {
        foreach (self::of_kind('jsonld') as $f) {
            if ((int) $f['target'] === (int) $product_id) {
                return $f;
            }
        }
        return null;
    }

    /**
     * Pure (tested from the command line): adds the brand to a Product node that has none, from the product's
     * own brand or the fallback (the store's name). The node keeps its @id and every other field.
     */
    public static function extend_node($node, $product_brand, $fallback) {
        if (!is_array($node) || !empty($node['brand'])) {
            return $node;
        }
        $brand = $product_brand !== '' ? $product_brand : $fallback;
        if ($brand !== '') {
            $node['brand'] = array('@type' => 'Brand', 'name' => $brand);
        }
        return $node;
    }

    private static function product_brand($product) {
        if (!is_object($product) || !method_exists($product, 'get_id')) {
            return '';
        }
        $terms = taxonomy_exists('product_brand') ? wp_get_post_terms($product->get_id(), 'product_brand', array('fields' => 'names')) : array();
        return is_array($terms) && !empty($terms[0]) ? (string) $terms[0] : '';
    }

    /** WooCommerce core's Product node (same @id: permalink#product). */
    public static function extend_wc($markup, $product) {
        $f = is_object($product) ? self::jsonld_for($product->get_id()) : null;
        return $f ? self::extend_node($markup, self::product_brand($product), $f['brand_fallback']) : $markup;
    }

    /** Yoast WooCommerce SEO and Rank Math Product entities, on the product page being shown. */
    public static function extend_graph_node($node) {
        $id = function_exists('get_queried_object_id') ? (int) get_queried_object_id() : 0;
        $f = $id ? self::jsonld_for($id) : null;
        if (!$f || !function_exists('wc_get_product')) {
            return $node;
        }
        return self::extend_node($node, self::product_brand(wc_get_product($id)), $f['brand_fallback']);
    }

    /** Pure: the virtual robots.txt with the AgentScope block appended once. */
    public static function robots_with($output, $block) {
        if ($block === '' || strpos($output, '# AgentScope') !== false) {
            return $output;
        }
        return rtrim($output) . "\n\n" . trim($block) . "\n";
    }

    public static function robots($output, $public) {
        foreach (self::of_kind('robots') as $f) {
            $output = self::robots_with($output, $f['text']);
        }
        return $output;
    }

    /** /llms.txt from the stored text, only when the site has no real llms.txt file. */
    public static function serve_llms_txt($wp) {
        $path = isset($_SERVER['REQUEST_URI']) ? (string) parse_url((string) wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH) : '';
        if ($path !== '/llms.txt' || file_exists(ABSPATH . 'llms.txt')) {
            return;
        }
        $fixes = self::of_kind('llms_txt');
        $f = $fixes ? reset($fixes) : null;
        if (!$f) {
            return;
        }
        status_header(200);
        header('Content-Type: text/plain; charset=utf-8');
        header('X-Robots-Tag: noindex');
        echo $f['text']; // phpcs:ignore WordPress.Security.EscapeOutput -- plain text, served as text/plain.
        exit;
    }

    // ---- Settings page: list and remove ---------------------------------------------------------------------

    public static function handle_remove() {
        if (!current_user_can('manage_options')) {
            wp_die('Not allowed.', 403);
        }
        check_admin_referer('agsc_remove_fix');
        $id = isset($_POST['fix_id']) ? sanitize_text_field(wp_unslash($_POST['fix_id'])) : '';
        $fixes = self::all();
        if (isset($fixes[$id]) && $fixes[$id]['kind'] === 'feed') {
            delete_option(self::FEED_OPTION);
        }
        unset($fixes[$id]);
        update_option(self::OPTION, $fixes, true);
        wp_safe_redirect(add_query_arg(array('page' => 'agsc-settings', 'agsc_msg' => 'fix-removed'), admin_url('admin.php')));
        exit;
    }

    public static function render_section() {
        $fixes = self::all();
        echo '<h2 class="agsc-h2">Fixes applied by AgentScope</h2><div class="agsc-form">';
        echo '<p class="agsc-help agsc-help--flush">Technical fixes the AgentScope app applied after your approval there (structured data, llms.txt, robots.txt groups, product feed). Undo them in the app, or remove one here.</p>';
        if (!$fixes) {
            echo '<p>None.</p></div>';
            return;
        }
        echo '<ul>';
        foreach ($fixes as $f) {
            $labels = array('org' => 'Structured data: organization', 'shipping' => 'Structured data: shipping details', 'website' => 'Structured data: website', 'breadcrumbs' => 'Structured data: breadcrumbs', 'variants' => 'Structured data: one offer per variation', 'returns' => 'Structured data: return policy');
            $what = isset($labels[$f['kind']]) ? $labels[$f['kind']] : ($f['kind'] === 'jsonld' ? 'Structured data brand on product #' . (int) $f['target'] : ($f['kind'] === 'llms_txt' ? '/llms.txt' : ($f['kind'] === 'feed' ? 'Product feed (' . (int) $f['products'] . ' products): ' . AGSC_Feed::PATH_JSONL : 'robots.txt AI agent groups')));
            echo '<li>' . esc_html($what) . ' · ' . esc_html(gmdate('Y-m-d H:i', (int) $f['applied_at'])) . ' UTC ';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="agsc-inline">';
            echo '<input type="hidden" name="action" value="agsc_remove_fix"><input type="hidden" name="fix_id" value="' . esc_attr($f['id']) . '">';
            wp_nonce_field('agsc_remove_fix');
            echo '<button type="submit" class="agsc-btn agsc-btn--ghost">Remove</button></form></li>';
        }
        echo '</ul></div>';
    }
}
