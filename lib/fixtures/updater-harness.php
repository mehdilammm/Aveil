<?php
// Test harness for AGSC_Updater without WordPress. Usage: php updater-harness.php <includes dir> <mode> [args...]
define('ABSPATH', '/');
define('AGSC_VERSION', '1.2.1');
define('AGSC_FILE', '/plugins/agentscope-core/agentscope-core.php');
$GLOBALS['agsc_tr'] = array();
function get_transient($k) { return isset($GLOBALS['agsc_tr'][$k]) ? $GLOBALS['agsc_tr'][$k] : false; }
function set_transient($k, $v, $ttl) { $GLOBALS['agsc_tr'][$k] = $v; return true; }
function delete_transient($k) { unset($GLOBALS['agsc_tr'][$k]); return true; }
function wp_parse_url($u, $c = -1) { return parse_url($u, $c); }
function plugin_basename($f) { return 'agentscope-core/agentscope-core.php'; }
function wp_delete_file($f) { @unlink($f); }
function is_wp_error($x) { return $x instanceof WP_Error; }
class WP_Error { public $code; public $message; public function __construct($c, $m) { $this->code = $c; $this->message = $m; } }
final class AGSC_Sender { public static function settings() { return array('endpoint' => '', 'store_id' => '', 'token' => ''); } }
// Fake network: the "app" answers with the JSON given on the command line.
$GLOBALS['body'] = '';
$GLOBALS['requests'] = array();
function wp_remote_get($url, $args) { $GLOBALS['requests'][] = array('url' => $url, 'args' => $args); return array('code' => 200, 'body' => $GLOBALS['body']); }
function wp_remote_retrieve_response_code($r) { return $r['code']; }
function wp_remote_retrieve_body($r) { return $r['body']; }
function download_url($url, $timeout) { $tmp = tempnam(sys_get_temp_dir(), 'agsc'); copy($GLOBALS['zip'], $tmp); return $tmp; }
define('DAY_IN_SECONDS', 86400);
require $argv[1] . '/class-agsc-updater.php';

$mode = $argv[2];
if ($mode === 'parse') {
    echo json_encode(AGSC_Updater::parse_latest($argv[3], $argv[4]));
} elseif ($mode === 'flow') {
    // $argv[3]: app JSON, $argv[4]: local zip that "download_url" returns
    $GLOBALS['body'] = $argv[3];
    $GLOBALS['zip'] = $argv[4];
    $t = AGSC_Updater::inject_update((object) array('response' => array()));
    AGSC_Updater::inject_update((object) array('response' => array())); // second check the same day: cached
    $u = $t->response['agentscope-core/agentscope-core.php'] ?? null;
    $file = $u ? AGSC_Updater::verified_download(false, $u->package, null) : null;
    $ok = is_string($file);
    if ($ok) { @unlink($file); }
    echo json_encode(array(
        'update' => $u ? $u->new_version : null,
        'requests' => count($GLOBALS['requests']),
        'request_url' => $GLOBALS['requests'][0]['url'] ?? null,
        'user_agent' => $GLOBALS['requests'][0]['args']['user-agent'] ?? null,
        'sent_body' => isset($GLOBALS['requests'][0]['args']['body']),
        'installed' => $ok,
        'error' => is_wp_error($file) ? $file->code : null,
    ));
}
