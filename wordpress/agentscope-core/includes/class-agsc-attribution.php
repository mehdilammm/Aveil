<?php
/**
 * AI referral attribution for orders (opt-in, off by default). WooCommerce Order Attribution is the main source; this
 * is a fallback for stores where it is off or loses the referrer.
 *
 * When a visitor lands from an AI assistant (referrer host or utm_source in the list below), the source, how it was
 * matched and the landing path (no query string) are kept in the WooCommerce session, then written to the order's
 * meta when the order is created (classic checkout and block / Store API checkout). HPOS compatible (order CRUD only).
 * Consent: when the WP Consent API is present, nothing is stored without "statistics" consent; the daily aggregate
 * referral count (AGSC_Traffic) is unaffected. No IP, user agent, name or email is stored. No network call.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Attribution {
    const SESSION_KEY = 'agsc_ai_referral';
    const META_SOURCE = '_agsc_ai_referral_source';
    const META_VIA    = '_agsc_ai_referral_via';
    const META_ENTRY  = '_agsc_ai_referral_entry';

    /** source => array(referrer domains, utm_source values). Kept in line with the app's lib/ai-orders.ts. */
    public static function sources() {
        return array(
            'ChatGPT'         => array(array('chatgpt.com', 'chat.openai.com'), array('chatgpt.com', 'chatgpt', 'openai')),
            'Perplexity'      => array(array('perplexity.ai'), array('perplexity', 'perplexity.ai')),
            'Gemini'          => array(array('gemini.google.com', 'bard.google.com'), array('gemini', 'gemini.google.com', 'bard')),
            'Copilot'         => array(array('copilot.microsoft.com'), array('copilot', 'copilot.microsoft.com')),
            'Claude'          => array(array('claude.ai'), array('claude', 'claude.ai')),
            'DeepSeek'        => array(array('chat.deepseek.com'), array('deepseek', 'chat.deepseek.com')),
            'Meta AI'         => array(array('meta.ai'), array('meta.ai')),
            'Grok'            => array(array('grok.com'), array('grok', 'grok.com')),
            'Mistral Le Chat' => array(array('chat.mistral.ai'), array('chat.mistral.ai', 'lechat')),
        );
    }

    /**
     * Pure (tested from the command line): utm_source first, then the referrer host. Returns array(source, via) or null.
     */
    public static function classify($referrer, $utm_source) {
        $utm = strtolower(trim((string) $utm_source));
        $parts = parse_url((string) $referrer);
        $host = is_array($parts) && isset($parts['host']) ? strtolower(rtrim($parts['host'], '.')) : '';
        $host = preg_replace('/^www\./', '', $host);
        foreach (self::sources() as $source => $rule) {
            if ($utm !== '' && in_array($utm, $rule[1], true)) {
                return array('source' => $source, 'via' => 'utm_source');
            }
        }
        if ($host !== '') {
            foreach (self::sources() as $source => $rule) {
                foreach ($rule[0] as $domain) {
                    if ($host === $domain || substr($host, -strlen('.' . $domain)) === '.' . $domain) {
                        return array('source' => $source, 'via' => 'referrer');
                    }
                }
            }
        }
        return null;
    }

    /** Pure: the landing path without its query string, at most 200 characters. */
    public static function entry_path($uri) {
        $path = parse_url((string) $uri, PHP_URL_PATH);
        return is_string($path) && $path !== '' ? substr($path, 0, 200) : '/';
    }

    public static function enabled() {
        $s = AGSC_Settings::get();
        return !empty($s['order_attribution']);
    }

    private static function consent_given() {
        if (function_exists('wp_has_consent')) {
            return (bool) wp_has_consent('statistics');
        }
        return true; // no consent framework on the site: the merchant's own opt-in (Settings) applies
    }

    public static function init() {
        add_action('before_woocommerce_init', array(__CLASS__, 'declare_compatibility'));
        if (!self::enabled()) {
            return;
        }
        add_action('wp', array(__CLASS__, 'capture'), 20);
        add_action('woocommerce_checkout_order_processed', array(__CLASS__, 'on_classic_order'), 10, 3);
        add_action('woocommerce_store_api_checkout_order_processed', array(__CLASS__, 'on_block_order'), 10, 1);
    }

    /** HPOS (custom order tables) and block checkout compatibility. */
    public static function declare_compatibility() {
        if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', AGSC_FILE, true);
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', AGSC_FILE, true);
        }
    }

    /** First AI landing of the session: remember it (front-end GET requests only, local work only). */
    public static function capture() {
        if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        if (!function_exists('WC') || !WC()->session || !self::consent_given()) {
            return;
        }
        $ref = isset($_SERVER['HTTP_REFERER']) ? (string) wp_unslash($_SERVER['HTTP_REFERER']) : '';
        $utm = isset($_GET['utm_source']) ? sanitize_text_field(wp_unslash($_GET['utm_source'])) : ''; // phpcs:ignore WordPress.Security.NonceVerification
        $match = self::classify($ref, $utm);
        if (!$match || WC()->session->get(self::SESSION_KEY)) {
            return;
        }
        if (!WC()->session->has_session()) {
            WC()->session->set_customer_session_cookie(true);
        }
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
        WC()->session->set(self::SESSION_KEY, array('source' => $match['source'], 'via' => $match['via'], 'entry' => self::entry_path($uri)));
    }

    public static function on_classic_order($order_id, $posted_data = array(), $order = null) {
        self::write($order instanceof WC_Order ? $order : wc_get_order($order_id));
    }

    public static function on_block_order($order) {
        self::write($order);
    }

    private static function write($order) {
        if (!$order instanceof WC_Order || !function_exists('WC') || !WC()->session) {
            return;
        }
        $ref = WC()->session->get(self::SESSION_KEY);
        if (!is_array($ref) || empty($ref['source'])) {
            return;
        }
        $order->update_meta_data(self::META_SOURCE, (string) $ref['source']);
        $order->update_meta_data(self::META_VIA, (string) $ref['via']);
        $order->update_meta_data(self::META_ENTRY, (string) $ref['entry']);
        $order->save();
        WC()->session->set(self::SESSION_KEY, null);
    }
}
