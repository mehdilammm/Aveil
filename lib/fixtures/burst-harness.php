<?php
// Test harness for AGSC_Burst::observe without WordPress: fake transients, clock and traffic table.
// Usage: php burst-harness.php <plugin includes dir> <JSON list of [t, source, category]>
define('ABSPATH', '/');
$GLOBALS['agsc_now'] = 0;
$GLOBALS['agsc_transients'] = array();
$GLOBALS['agsc_moves'] = 0;
function get_transient($k) { return isset($GLOBALS['agsc_transients'][$k]) ? $GLOBALS['agsc_transients'][$k] : false; }
function set_transient($k, $v, $ttl) { $GLOBALS['agsc_transients'][$k] = $v; return true; }
final class AGSC_Traffic { public static function move_to_checker($e) { $GLOBALS['agsc_moves']++; } }
require $argv[1] . '/class-agsc-burst.php';
// observe() reads time(); the harness runs each request at its own fake time by shifting the stored events.
$out = array();
foreach (json_decode($argv[2], true) as $req) {
    $offset = time() - (int) $req[0];
    // Re-anchor stored events so that "now" for this request is $req[0].
    $events = get_transient(AGSC_Burst::KEY);
    if (is_array($events)) {
        foreach ($events as $i => $e) { $events[$i]['t'] = (int) $e['orig'] + $offset; }
        set_transient(AGSC_Burst::KEY, $events, 120);
    }
    $burst = AGSC_Burst::observe(array('source' => $req[1], 'category' => $req[2]), '2026-10-22', 'not-found', 404);
    $events = get_transient(AGSC_Burst::KEY);
    $last = count($events) - 1;
    $events[$last]['orig'] = (int) $req[0];
    foreach ($events as $i => $e) { if (!isset($e['orig'])) { $events[$i]['orig'] = (int) $req[0]; } }
    set_transient(AGSC_Burst::KEY, $events, 120);
    $out[] = $burst ? 'checker' : 'unverified';
}
echo json_encode(array('labels' => $out, 'moved' => $GLOBALS['agsc_moves']));
