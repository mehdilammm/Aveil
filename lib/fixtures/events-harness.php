<?php
// Runs AGSC_Events (plugin 1.7.0) with small WordPress stand-ins. Usage: php events-harness.php <case>
define('ABSPATH', '/');
define('WPINC', 'wp-includes');
define('WP_PLUGIN_DIR', sys_get_temp_dir() . '/agsc-events-plugins');
define('DAY_IN_SECONDS', 86400);
define('MINUTE_IN_SECONDS', 60);
define('AGSC_FILE', '/plugins/agentscope-core/agentscope-core.php');
$GLOBALS['wp_version'] = '6.8.3';
$GLOBALS['agsc_options'] = array();
$GLOBALS['agsc_posts'] = array();
$GLOBALS['agsc_cron'] = array();
$GLOBALS['agsc_answer'] = 200;
$GLOBALS['agsc_connected'] = true;
$GLOBALS['agsc_remote_calls_during_hooks'] = 0;
$GLOBALS['agsc_plugin_versions'] = array('woo-cache/woo-cache.php' => array('Name' => 'Woo Cache', 'Version' => '2.1.0'));
function get_option($k, $d = false) { return array_key_exists($k, $GLOBALS['agsc_options']) ? $GLOBALS['agsc_options'][$k] : $d; }
function update_option($k, $v, $a = null) { $GLOBALS['agsc_options'][$k] = $v; return true; }
function delete_option($k) { unset($GLOBALS['agsc_options'][$k]); return true; }
function wp_generate_uuid4() { static $n = 0; $n++; return sprintf('00000000-0000-4000-8000-%012d', $n); }
function wp_json_encode($v) { return json_encode($v); }
function wp_parse_url($u, $c = -1) { return parse_url($u, $c); }
function wp_list_pluck($rows, $k) { return array_map(function ($r) use ($k) { return $r[$k]; }, $rows); }
function wp_strip_all_tags($s) { return trim(strip_tags($s)); }
function wp_next_scheduled($h) { return isset($GLOBALS['agsc_cron'][$h]) ? $GLOBALS['agsc_cron'][$h] : false; }
function wp_schedule_single_event($t, $h) { $GLOBALS['agsc_cron'][$h] = $t; return true; }
function wp_clear_scheduled_hook($h) { unset($GLOBALS['agsc_cron'][$h]); }
function is_wp_error($r) { return false; }
function wp_remote_retrieve_response_code($r) { return $r['code']; }
function wp_remote_post($url, $args) { $GLOBALS['agsc_posts'][] = array('url' => $url, 'args' => $args); return array('code' => $GLOBALS['agsc_answer']); }
function get_plugin_data($path) { $f = basename(dirname($path)) . '/' . basename($path); return $GLOBALS['agsc_plugin_versions'][$f] ?? array('Name' => '', 'Version' => ''); }
function plugin_basename($f) { return 'agentscope-core/agentscope-core.php'; }
function get_the_title($id) { return 'Round LED Mirror'; }
function get_post_status($id) { return 'publish'; }
function add_action() {}
function add_filter() {}
final class Agsc_Theme { public function __construct(private $n, private $v, private $s) {} public function exists() { return true; } public function get($k) { return $k === 'Name' ? $this->n : $this->v; } public function get_stylesheet() { return $this->s; } }
function wp_get_theme($s) { return new Agsc_Theme('Astra', '4.8.1', $s); }
final class AGSC_Sender {
    public static function settings() { return array('endpoint' => 'https://app.test/api/ingest/traffic', 'store_id' => '11111111-1111-4111-8111-111111111111', 'token' => 'agsc_test'); }
    public static function is_configured($s = null) { return $GLOBALS['agsc_connected']; }
}
@mkdir(WP_PLUGIN_DIR . '/woo-cache', 0777, true);
file_put_contents(WP_PLUGIN_DIR . '/woo-cache/woo-cache.php', "<?php\n/* Plugin Name: Woo Cache */\n");
require __DIR__ . '/../../wordpress/agentscope-core/includes/class-agsc-events.php';
$case = $argv[1] ?? '';
$out = array();
if ($case === 'upgrade') {
    // Before the update the old version is read; after it, the new one.
    AGSC_Events::before_install(true, array('plugin' => 'woo-cache/woo-cache.php'));
    $GLOBALS['agsc_plugin_versions']['woo-cache/woo-cache.php']['Version'] = '2.2.0';
    $before = count($GLOBALS['agsc_posts']);
    AGSC_Events::after_upgrade(null, array('type' => 'plugin', 'action' => 'update', 'plugins' => array('woo-cache/woo-cache.php')));
    AGSC_Events::theme_switched('Storefront', new Agsc_Theme('Storefront', '4.6.0', 'storefront'), new Agsc_Theme('Astra', '4.8.1', 'astra'));
    AGSC_Events::plugin_deactivated('woo-cache/woo-cache.php');
    AGSC_Events::plugin_deactivated('agentscope-core/agentscope-core.php');
    $out['no_network_in_hooks'] = count($GLOBALS['agsc_posts']) === $before;
    $out['queue'] = get_option('agsc_event_queue');
    $out['cron'] = isset($GLOBALS['agsc_cron']['agsc_send_events']);
} elseif ($case === 'product') {
    $now = time();
    list($a, $m) = AGSC_Events::debounce(array(), 173, $now);
    list($b, $m) = AGSC_Events::debounce($m, 173, $now + 60);
    list($c, $m) = AGSC_Events::debounce($m, 174, $now + 60);
    list($d, $m) = AGSC_Events::debounce($m, 173, $now + 301);
    $out['debounce'] = array($a, $b, $c, $d);
    AGSC_Events::product_updated(173);
    AGSC_Events::product_updated(173); // inside 5 minutes: not queued again
    $out['queue'] = get_option('agsc_event_queue');
    $GLOBALS['agsc_connected'] = false;
    $GLOBALS['agsc_options'] = array();
    AGSC_Events::product_updated(175);
    $out['not_connected'] = get_option('agsc_event_queue', array());
    $out['core'] = AGSC_Events::core_version_in("<?php\n\$wp_version = '6.9';\n");
} elseif ($case === 'flush') {
    AGSC_Events::queue(array(AGSC_Events::event('plugin_updated', 'Woo Cache', 'woo-cache/woo-cache.php', '2.1.0', '2.2.0')));
    $GLOBALS['agsc_answer'] = 500;
    $out['failed'] = AGSC_Events::flush();
    $out['after_failed'] = count(get_option('agsc_event_queue'));
    $GLOBALS['agsc_answer'] = 200;
    $out['ok'] = AGSC_Events::flush();
    $out['after_ok'] = count(get_option('agsc_event_queue'));
    $p = $GLOBALS['agsc_posts'][1];
    $out['url'] = $p['url'];
    $ts = $p['args']['headers']['X-AgentScope-Timestamp'];
    $out['signature_ok'] = $p['args']['headers']['X-AgentScope-Signature'] === 'sha256=' . hash_hmac('sha256', $ts . '.' . $p['args']['body'], 'agsc_test');
    $out['body'] = json_decode($p['args']['body'], true);
}
echo json_encode($out);
