<?php
/**
 * Burst detection (HEURISTIC). SEO/GEO checker tools test a site by sending several AI bot user agents within
 * seconds; real AI crawlers rarely arrive together. Within any 60 seconds:
 *   - 3 or more different AI sources (for example OpenAI, Anthropic and Perplexity), or
 *   - 5 or more AI bot requests using 3 or more different bot names (source + type),
 * are recorded with confidence "likely-checker-tool" instead of "unverified-user-agent". Requests of the burst that
 * were already counted are moved to that confidence too. This is a guess from timing only, never a certainty:
 * a real crawler can be caught in a burst, and a slow checker can be missed.
 * Only the last 60 seconds of AI bot requests are kept (source, type, route, status; no IP, no user agent), in a
 * short-lived transient.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Burst {
    const KEY           = 'agsc_recent_bots';
    const WINDOW        = 60;
    const MIN_SOURCES   = 3;
    const MIN_REQUESTS  = 5;
    const MIN_BOT_NAMES = 3;
    const MAX_EVENTS    = 50;
    const CONFIDENCE    = 'likely-checker-tool';

    /** Pure rule, no WordPress calls (tested from the command line). $events: list of array('t','source','category'). */
    public static function is_burst($events, $now) {
        $sources = array();
        $bots = array();
        $count = 0;
        foreach ((array) $events as $e) {
            if (!isset($e['t']) || (int) $e['t'] <= (int) $now - self::WINDOW || (int) $e['t'] > (int) $now) {
                continue;
            }
            $count++;
            $sources[(string) $e['source']] = true;
            $bots[(string) $e['source'] . '/' . (string) $e['category']] = true;
        }
        return count($sources) >= self::MIN_SOURCES || ($count >= self::MIN_REQUESTS && count($bots) >= self::MIN_BOT_NAMES);
    }

    /** Keeps events inside the window, newest MAX_EVENTS. */
    public static function prune($events, $now) {
        $kept = array();
        foreach ((array) $events as $e) {
            if (isset($e['t']) && (int) $e['t'] > (int) $now - self::WINDOW) {
                $kept[] = $e;
            }
        }
        return array_slice($kept, -self::MAX_EVENTS);
    }

    /**
     * Adds this AI bot request and tells whether it is part of a burst. When a burst starts, the earlier requests of
     * the window that were counted as unverified-user-agent are moved to likely-checker-tool.
     */
    public static function observe($signal, $day, $route, $status) {
        $now = time();
        $events = self::prune(get_transient(self::KEY), $now);
        $events[] = array('t' => $now, 'day' => $day, 'source' => $signal['source'], 'category' => $signal['category'], 'route' => $route, 'status' => (int) $status, 'moved' => false);
        $burst = self::is_burst($events, $now);
        if ($burst) {
            $last = count($events) - 1;
            foreach ($events as $i => $e) {
                if ($i === $last) {
                    $events[$i]['moved'] = true; // recorded directly as likely-checker-tool by the caller
                } elseif (empty($e['moved'])) {
                    AGSC_Traffic::move_to_checker($e);
                    $events[$i]['moved'] = true;
                }
            }
        }
        set_transient(self::KEY, $events, 2 * self::WINDOW);
        return $burst;
    }
}
