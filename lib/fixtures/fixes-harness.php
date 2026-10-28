<?php
// Runs AGSC_Fixes with small WordPress stand-ins. Usage: php fixes-harness.php <case> [args...]
define('ABSPATH', sys_get_temp_dir() . '/agsc-fixes-root/');
@mkdir(ABSPATH);
define('AGSC_VERSION', '1.6.0');
$GLOBALS['agsc_opts'] = array();
function get_option($k, $d = false) { return array_key_exists($k, $GLOBALS['agsc_opts']) ? $GLOBALS['agsc_opts'][$k] : $d; }
function update_option($k, $v, $a = null) { $GLOBALS['agsc_opts'][$k] = $v; $GLOBALS['agsc_autoload'][$k] = $a; return true; }
function delete_option($k) { unset($GLOBALS['agsc_opts'][$k]); return true; }
function home_url($p = '') { return 'https://matha.site' . $p; }
function sanitize_text_field($s) { return trim(preg_replace('/[\r\n\t ]+/', ' ', strip_tags((string) $s))); }
function rest_ensure_response($r) { return $r; }
class WP_Error { public $code; function __construct($c, $m = '', $d = null) { $this->code = $c; } }
final class AGSC_Sender {
    public static function settings() { return array('endpoint' => 'https://app.test/api/ingest/traffic', 'store_id' => '11111111-1111-4111-8111-111111111111', 'token' => 'agsc_test'); }
    public static function is_configured($s = null) { return true; }
}
final class Agsc_Req {
    private $h; private $b;
    function __construct($h, $b) { $this->h = $h; $this->b = $b; }
    function get_header($k) { return $this->h[$k] ?? null; }
    function get_body() { return $this->b; }
}
require __DIR__ . '/../../wordpress/agentscope-core/includes/class-agsc-fixes.php';
require __DIR__ . '/../../wordpress/agentscope-core/includes/class-agsc-feed.php';
$sign = function ($body, $ts, $nonce) { return 'sha256=' . hash_hmac('sha256', $ts . '.' . $nonce . '.' . $body, 'agsc_test'); };
$req = function ($body, $ts = null, $nonce = null, $sig = null) use ($sign) {
    $ts = $ts ?? (string) time();
    $nonce = $nonce ?? bin2hex(random_bytes(16));
    return new Agsc_Req(array('x_agentscope_timestamp' => $ts, 'x_agentscope_nonce' => $nonce, 'x_agentscope_signature' => $sig ?? $sign($body, $ts, $nonce)), $body);
};
$case = $argv[1] ?? '';
$out = array();
if ($case === 'auth') {
    $body = '{"action":"status"}';
    $nonce = bin2hex(random_bytes(16));
    $ts = (string) time();
    $out['good'] = AGSC_Fixes::signed($req($body, $ts, $nonce));
    $out['replay'] = AGSC_Fixes::signed($req($body, $ts, $nonce));
    $out['bad_sig'] = AGSC_Fixes::signed($req($body, null, null, 'sha256=00'));
    $out['old'] = AGSC_Fixes::signed($req($body, (string) (time() - 400)));
    $out['tampered'] = AGSC_Fixes::signed(new Agsc_Req(array('x_agentscope_timestamp' => $ts, 'x_agentscope_nonce' => str_repeat('a', 32), 'x_agentscope_signature' => $sign($body, $ts, str_repeat('a', 32))), '{"action":"apply"}'));
} elseif ($case === 'apply') {
    $id = '0b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c';
    $body = json_encode(array('action' => 'apply', 'fixes' => array(
        array('id' => $id, 'kind' => 'jsonld', 'target' => 174, 'payload' => array('brand_fallback' => '<b>Matha</b> Mirrors')),
        array('id' => '1b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c', 'kind' => 'llms_txt', 'payload' => array('text' => "# Matha Mirrors\n")),
        array('id' => 'bad', 'kind' => 'jsonld', 'target' => 1),
        array('id' => '2b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c', 'kind' => 'php_eval', 'payload' => array('text' => 'x')),
    )));
    $r = AGSC_Fixes::handle($req($body));
    $out['applied'] = $r['applied'];
    $out['brand_fallback'] = AGSC_Fixes::all()[$id]['brand_fallback'];
    $r2 = AGSC_Fixes::handle($req(json_encode(array('action' => 'revert', 'ids' => array($id)))));
    $out['after_revert'] = $r2['applied'];
} elseif ($case === 'node') {
    $wc = array('@type' => 'Product', '@id' => 'https://matha.site/product/round-led-mirror/#product', 'name' => 'Round LED Mirror', 'offers' => array(array('@type' => 'Offer', 'price' => '800')));
    $out['fallback'] = AGSC_Fixes::extend_node($wc, '', 'Matha Mirrors');
    $out['own_brand'] = AGSC_Fixes::extend_node($wc, 'Matha', 'Store');
    $out['kept'] = AGSC_Fixes::extend_node($wc + array('brand' => array('@type' => 'Brand', 'name' => 'X')), 'Y', 'Z');
    // Escaping as WooCommerce prints it (JSON_HEX_TAG), and as required for plugin output (JSON_HEX_TAG | JSON_HEX_AMP).
    $evil = AGSC_Fixes::extend_node($wc, '</script><script>alert(1)</script> & co', '');
    $out['encoded'] = json_encode(array('@context' => 'https://schema.org/', '@graph' => array($evil)), JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES);
} elseif ($case === 'robots') {
    $block = "# AgentScope: AI search agents\nUser-agent: OAI-SearchBot\nAllow: /\n";
    $wp = "User-agent: *\nDisallow: /wp-admin/\n";
    $once = AGSC_Fixes::robots_with($wp, $block);
    $out['once'] = $once;
    $out['twice_same'] = AGSC_Fixes::robots_with($once, $block) === $once;
} elseif ($case === 'feed') {
    // 1.8.0 (G1): the payload the app builds, from a file written by the test.
    $p = json_decode(file_get_contents($argv[2]), true);
    $id = '3b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c';
    $r = AGSC_Fixes::handle($req(json_encode(array('action' => 'apply', 'fixes' => array(array('id' => $id, 'kind' => 'feed', 'payload' => $p))))));
    $out['done'] = array_map(function ($d) { return $d['id']; }, $r['done']);
    $out['record'] = AGSC_Fixes::all()[$id] ?? null;
    $out['autoload'] = $GLOBALS['agsc_autoload'][AGSC_Fixes::FEED_OPTION] ?? 'unset';
    $out['status'] = AGSC_Feed::status(AGSC_Fixes::of_kind('feed'));
    $data = get_option(AGSC_Fixes::FEED_OPTION, null);
    foreach (array('jsonl' => AGSC_Feed::PATH_JSONL, 'metadata' => AGSC_Feed::PATH_METADATA, 'csv' => AGSC_Feed::PATH_CSV, 'other' => '/agentscope-feed/x') as $k => $path) {
        $out['served'][$k] = AGSC_Feed::response($path, $data);
    }
    $out['subdir'] = AGSC_Feed::relative_path('/shop/agentscope-feed.csv', '/shop/');
    $out['root'] = AGSC_Feed::relative_path('/agentscope-feed.csv', '/');
    $bad = function ($q) { return AGSC_Fixes::clean_feed($q) === null; };
    $out['rejected'] = array(
        'bad_line'    => $bad(array('metadata' => $p['metadata'], 'jsonl' => "{\"id\":\"1\",\"variants\":[]}\nnot json\n", 'csv' => $p['csv'])),
        'no_variants' => $bad(array('metadata' => $p['metadata'], 'jsonl' => "{\"id\":\"1\"}\n", 'csv' => $p['csv'])),
        'csv'         => $bad(array('metadata' => $p['metadata'], 'jsonl' => $p['jsonl'], 'csv' => "<?php echo 1;")),
        'metadata'    => $bad(array('metadata' => '{}', 'jsonl' => $p['jsonl'], 'csv' => $p['csv'])),
        'too_big'     => $bad(array('metadata' => $p['metadata'], 'jsonl' => str_repeat(' ', AGSC_Fixes::MAX_FEED + 1), 'csv' => $p['csv'])),
    );
    // A second feed replaces the first; undo removes the stored files.
    $id2 = '4b0c7c3e-2f4a-4b8e-9a51-1d2e3f4a5b6c';
    AGSC_Fixes::handle($req(json_encode(array('action' => 'apply', 'fixes' => array(array('id' => $id2, 'kind' => 'feed', 'payload' => $p))))));
    $out['feeds_after_second'] = array_keys(AGSC_Fixes::of_kind('feed'));
    AGSC_Fixes::handle($req(json_encode(array('action' => 'revert', 'ids' => array($id2)))));
    $out['after_revert'] = array('fixes' => array_keys(AGSC_Fixes::of_kind('feed')), 'data' => get_option(AGSC_Fixes::FEED_OPTION, null));
}
echo json_encode($out);
