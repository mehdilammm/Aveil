<?php
// Runs AGSC_Bothits with small WordPress stand-ins. Usage: php bothits-harness.php <case>
define('ABSPATH', '/');
define('DAY_IN_SECONDS', 86400);
define('MINUTE_IN_SECONDS', 60);
define('ARRAY_A', 'ARRAY_A');
$GLOBALS['agsc_posts'] = array();
$GLOBALS['agsc_answer'] = 200;
$GLOBALS['agsc_connected'] = true;
function wp_unslash($v) { return $v; }
function wp_generate_uuid4() { static $n = 0; $n++; return sprintf('00000000-0000-4000-8000-%012d', $n); }
function wp_json_encode($v) { return json_encode($v); }
function wp_parse_url($u, $c = -1) { return parse_url($u, $c); }
function wp_list_pluck($rows, $k) { return array_map(function ($r) use ($k) { return $r[$k]; }, $rows); }
function is_wp_error($r) { return false; }
function wp_remote_retrieve_response_code($r) { return $r['code']; }
function wp_remote_post($url, $args) { $GLOBALS['agsc_posts'][] = array('url' => $url, 'args' => $args); return array('code' => $GLOBALS['agsc_answer']); }
final class AGSC_Sender {
    public static function settings() { return array('endpoint' => 'https://app.test/api/ingest/traffic', 'store_id' => '11111111-1111-4111-8111-111111111111', 'token' => 'agsc_test'); }
    public static function is_configured($s = null) { return $GLOBALS['agsc_connected']; }
}
// $wpdb on an in-memory array.
final class Agsc_Fake_Db {
    public $prefix = 'wp_';
    public $rows = array();
    private $id = 0;
    public function insert($t, $data) { $this->rows[] = array('id' => ++$this->id) + $data; return 1; }
    public function prepare($q, ...$a) { foreach ($a as $v) { $q = preg_replace('/%[sd]/', is_int($v) ? (string) $v : "'" . $v . "'", $q, 1); } return $q; }
    public function query($q) {
        if (preg_match("/seen_at < '([^']+)'/", $q, $m)) { $this->rows = array_values(array_filter($this->rows, function ($r) use ($m) { return $r['seen_at'] >= $m[1]; })); }
        elseif (preg_match('/id IN \(([0-9,]+)\)/', $q, $m)) { $ids = array_map('intval', explode(',', $m[1])); $this->rows = array_values(array_filter($this->rows, function ($r) use ($ids) { return !in_array($r['id'], $ids, true); })); }
        elseif (strpos($q, 'DELETE FROM') === 0) { $this->rows = array(); }
        return 1;
    }
    public function get_results($q) { return array_slice($this->rows, 0, 500); }
}
$GLOBALS['wpdb'] = new Agsc_Fake_Db();
require __DIR__ . '/../../wordpress/agentscope-core/includes/class-agsc-bothits.php';
$db = $GLOBALS['wpdb'];
$claude = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
$_SERVER['REMOTE_ADDR'] = '216.73.216.10';
$_SERVER['REQUEST_URI'] = '/product/round-led-mirror/?email=a@b.co';
$case = $argv[1] ?? '';
$out = array();
if ($case === 'match') {
    foreach (array($claude, 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)', 'Mozilla/5.0 (iPhone) Safari/604.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'NotGPTBot/1.0', 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)') as $ua) {
        $out[] = AGSC_Bothits::match_bot($ua);
    }
} elseif ($case === 'record') {
    AGSC_Bothits::record('Mozilla/5.0 (Windows NT 10.0) Chrome/130', 'GET', 200); // a person
    AGSC_Bothits::record($claude, 'GET', 200);
    $GLOBALS['agsc_connected'] = false;
    AGSC_Bothits::record($claude, 'GET', 200); // not connected: nothing kept
    $out = array('rows' => $db->rows, 'payload' => json_decode(AGSC_Bothits::payload($db->rows), true));
} elseif ($case === 'flush') {
    AGSC_Bothits::record($claude, 'GET', 200);
    AGSC_Bothits::record($claude, 'HEAD', 404);
    $db->rows[] = array('id' => 99, 'hit_id' => 'old', 'seen_at' => gmdate('Y-m-d H:i:s', time() - 8 * DAY_IN_SECONDS), 'bot' => 'ClaudeBot', 'ip' => '1.2.3.4', 'user_agent' => $claude, 'url_path' => '/', 'method' => 'GET', 'http_status' => 200);
    $GLOBALS['agsc_answer'] = 500;
    $out['failed'] = AGSC_Bothits::flush();
    $out['after_failed'] = count($db->rows); // the 8-day-old row is gone, the 2 new ones kept
    $GLOBALS['agsc_answer'] = 200;
    $out['ok'] = AGSC_Bothits::flush();
    $out['after_ok'] = count($db->rows);
    $p = $GLOBALS['agsc_posts'][1];
    $out['url'] = $p['url'];
    $ts = $p['args']['headers']['X-AgentScope-Timestamp'];
    $out['signature_ok'] = $p['args']['headers']['X-AgentScope-Signature'] === 'sha256=' . hash_hmac('sha256', $ts . '.' . $p['args']['body'], 'agsc_test');
    $out['body'] = json_decode($p['args']['body'], true);
}
echo json_encode($out);
