<?php
/**
 * Recognises AgentScope's own test requests (full scan and the public /check, including the AI bot user agents)
 * by the X-AgentScope-Check header, so they are never counted as traffic.
 *
 *   Signed:   "v1.<unix seconds>.<hex HMAC-SHA256(connection token, "agentscope-check.<unix seconds>")>"
 *             Accepted when this site has a connection token and the time is within 10 minutes.
 *   Unsigned: "1". Accepted only while no connection token is saved. Once connected, only signed values count,
 *             so nobody can hide requests from the totals by adding the header.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Check {
    const MAX_SKEW = 600;

    /** True when the current request is an AgentScope check. */
    public static function is_agentscope_request() {
        $value = isset($_SERVER['HTTP_X_AGENTSCOPE_CHECK']) ? trim((string) wp_unslash($_SERVER['HTTP_X_AGENTSCOPE_CHECK'])) : '';
        if ($value === '') {
            return false;
        }
        $settings = AGSC_Sender::settings();
        return self::verify($value, (string) $settings['token'], time());
    }

    /** Pure check, no WordPress calls (tested from the command line). */
    public static function verify($value, $token, $now) {
        $value = trim((string) $value);
        if ($value === '') {
            return false;
        }
        if ($token === '') {
            return $value === '1' || strpos($value, 'v1.') === 0;
        }
        if (!preg_match('/^v1\.(\d{9,11})\.([0-9a-f]{64})$/', $value, $m)) {
            return false;
        }
        if (abs((int) $now - (int) $m[1]) > self::MAX_SKEW) {
            return false;
        }
        $expected = hash_hmac('sha256', 'agentscope-check.' . $m[1], $token);
        return hash_equals($expected, $m[2]);
    }
}
