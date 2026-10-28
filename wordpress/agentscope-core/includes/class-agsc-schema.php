<?php
/**
 * Structured data the AgentScope app adds after the merchant's approval (1.8.0, Milestone G). Each part is one
 * signed fix (AGSC_Fixes) that the merchant can undo on its own:
 *   org         - G2: Organization / OnlineStore on the home page: the site's name, address and logo (custom logo
 *                 or site icon), read live; phone, email and profile links only as the app found them published on
 *                 the site (payload). Products' sellers point to it by @id.
 *   shipping    - G3: OfferShippingDetails on each offer of a product that needs shipping, from the rates the app
 *                 read in the WooCommerce shipping zones (only the zones it could express exactly); delivery times
 *                 only when the merchant gave them.
 *   website     - G5: WebSite on the home page, with a SearchAction only when the app checked the search address.
 *   breadcrumbs - G5: BreadcrumbList from the product's or category's real category path.
 *   variants    - G6: one Offer per variation inside the variable product's AggregateOffer (same Product @id).
 *   returns     - G7: MerchantReturnPolicy on each offer, as the merchant confirmed it.
 * Nothing is added where WooCommerce, Yoast SEO or Rank Math already output the same node (never a duplicate), and
 * an existing value is never replaced. No network calls: page loads read the autoloaded fixes option and the
 * store's own data. Output is encoded with JSON_HEX_TAG | JSON_HEX_AMP, so text cannot close the script tag.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Schema {
    const KINDS        = array('org', 'shipping', 'website', 'breadcrumbs', 'variants', 'returns');
    const MAX_VARIANTS = 100;
    const RETURN_CATEGORIES = array('MerchantReturnFiniteReturnWindow', 'MerchantReturnNotPermitted', 'MerchantReturnUnlimitedWindow');
    const RETURN_METHODS    = array('ReturnByMail', 'ReturnInStore', 'ReturnAtKiosk');
    const RETURN_FEES       = array('FreeReturn', 'ReturnFeesCustomerResponsibility', 'ReturnShippingFees', 'RestockingFees');

    public static function init() {
        add_filter('woocommerce_structured_data_product', array(__CLASS__, 'extend_wc_product'), 30, 2);
        add_filter('wpseo_schema_product', array(__CLASS__, 'extend_graph_product'), 30, 1);
        add_filter('rank_math/snippet/rich_snippet_product_entity', array(__CLASS__, 'extend_graph_product'), 30, 1);
        add_action('wp_footer', array(__CLASS__, 'output'), 20);
    }

    // ---- Payloads (pure, tested from the command line) -------------------------------------------------------

    private static function text($v, $max) {
        return substr(trim(preg_replace('/[\r\n\t ]+/', ' ', strip_tags((string) $v))), 0, $max);
    }

    private static function https($v) {
        $v = trim((string) $v);
        return preg_match('#^https://[^\s<>"]+$#', $v) ? substr($v, 0, 500) : '';
    }

    private static function amount($v) {
        $v = trim((string) $v);
        return preg_match('/^\d{1,9}(\.\d{1,4})?$/', $v) ? $v : null;
    }

    private static function days($v, $max) {
        if (!is_array($v) || count($v) !== 2) {
            return null;
        }
        $a = (int) $v[0];
        $b = (int) $v[1];
        return ($a >= 0 && $b >= $a && $b <= $max && (string) $a === (string) $v[0] && (string) $b === (string) $v[1]) ? array($a, $b) : null;
    }

    /** The payload of one kind, kept only when every field is well-formed; null refuses the fix. */
    public static function clean_payload($kind, $p) {
        $p = is_array($p) ? $p : array();
        if ($kind === 'org') {
            $out = array('type' => isset($p['type']) && $p['type'] === 'Organization' ? 'Organization' : 'OnlineStore');
            if (!empty($p['telephone'])) {
                $tel = self::text($p['telephone'], 40);
                if (!preg_match('/^\+?[0-9][0-9 ().-]{5,38}$/', $tel)) {
                    return null;
                }
                $out['telephone'] = $tel;
            }
            if (!empty($p['email'])) {
                $mail = self::text($p['email'], 120);
                if (!preg_match('/^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i', $mail)) {
                    return null;
                }
                $out['email'] = $mail;
            }
            $same = array();
            foreach (array_slice((array) ($p['same_as'] ?? array()), 0, 10) as $u) {
                $u = self::https($u);
                if ($u === '') {
                    return null;
                }
                $same[] = $u;
            }
            if ($same) {
                $out['same_as'] = $same;
            }
            return $out;
        }
        if ($kind === 'shipping') {
            $currency = isset($p['currency']) ? (string) $p['currency'] : '';
            if (!preg_match('/^[A-Z]{3}$/', $currency) || empty($p['zones']) || !is_array($p['zones']) || count($p['zones']) > 50) {
                return null;
            }
            $zones = array();
            foreach ($p['zones'] as $z) {
                if (!is_array($z) || !isset($z['country']) || !preg_match('/^[A-Z]{2}$/', (string) $z['country']) || empty($z['rates']) || !is_array($z['rates']) || count($z['rates']) > 5) {
                    return null;
                }
                $zone = array('country' => (string) $z['country']);
                if (!empty($z['region'])) {
                    $zone['region'] = self::text($z['region'], 100);
                }
                $rates = array();
                foreach ($z['rates'] as $r) {
                    $type = is_array($r) && isset($r['type']) ? (string) $r['type'] : '';
                    if ($type === 'free') {
                        $rates[] = array('type' => 'free');
                    } elseif ($type === 'flat' && self::amount($r['cost'] ?? '') !== null) {
                        $rates[] = array('type' => 'flat', 'cost' => self::amount($r['cost']));
                    } elseif ($type === 'free_min' && self::amount($r['min'] ?? '') !== null) {
                        $rates[] = array('type' => 'free_min', 'min' => self::amount($r['min']));
                    } else {
                        return null;
                    }
                }
                $zone['rates'] = $rates;
                if (isset($z['delivery'])) {
                    $h = self::days($z['delivery']['handling'] ?? null, 60);
                    $t = self::days($z['delivery']['transit'] ?? null, 90);
                    if (!$h || !$t) {
                        return null;
                    }
                    $zone['delivery'] = array('handling' => $h, 'transit' => $t);
                }
                $zones[] = $zone;
            }
            return array('currency' => $currency, 'zones' => $zones);
        }
        if ($kind === 'website') {
            $search = isset($p['search']) ? self::https($p['search']) : '';
            if ($search !== '' && strpos($search, '{search_term_string}') === false) {
                return null;
            }
            return array('search' => $search);
        }
        if ($kind === 'returns') {
            $cat = isset($p['category']) ? (string) $p['category'] : '';
            $countries = array_values(array_filter((array) ($p['countries'] ?? array()), function ($c) { return is_string($c) && preg_match('/^[A-Z]{2}$/', $c); }));
            if (!in_array($cat, self::RETURN_CATEGORIES, true) || !$countries || count($countries) > 50) {
                return null;
            }
            $out = array('category' => $cat, 'countries' => $countries);
            if ($cat === 'MerchantReturnFiniteReturnWindow') {
                $d = isset($p['days']) ? (int) $p['days'] : 0;
                if ($d < 1 || $d > 365) {
                    return null;
                }
                $out['days'] = $d;
            }
            if ($cat !== 'MerchantReturnNotPermitted') {
                if (isset($p['method']) && in_array($p['method'], self::RETURN_METHODS, true)) {
                    $out['method'] = $p['method'];
                }
                if (isset($p['fees']) && in_array($p['fees'], self::RETURN_FEES, true)) {
                    $out['fees'] = $p['fees'];
                }
            }
            if (!empty($p['link'])) {
                $link = self::https($p['link']);
                if ($link === '') {
                    return null;
                }
                $out['link'] = $link;
            }
            return $out;
        }
        return in_array($kind, array('breadcrumbs', 'variants'), true) ? array() : null;
    }

    // ---- Nodes (pure) -----------------------------------------------------------------------------------------

    public static function org_id($home) {
        return rtrim($home, '/') . '/#organization';
    }

    public static function org_node($site, $p) {
        $node = array('@type' => $p['type'], '@id' => self::org_id($site['url']), 'name' => $site['name'], 'url' => $site['url']);
        if ($site['logo'] !== '') {
            $node['logo'] = array('@type' => 'ImageObject', 'url' => $site['logo']);
        }
        foreach (array('telephone' => 'telephone', 'email' => 'email', 'same_as' => 'sameAs') as $from => $to) {
            if (!empty($p[$from])) {
                $node[$to] = $p[$from];
            }
        }
        return $node;
    }

    public static function website_node($site, $p, $with_org) {
        $node = array('@type' => 'WebSite', '@id' => rtrim($site['url'], '/') . '/#website', 'name' => $site['name'], 'url' => $site['url']);
        if ($with_org) {
            $node['publisher'] = array('@id' => self::org_id($site['url']));
        }
        if (!empty($p['search'])) {
            $node['potentialAction'] = array('@type' => 'SearchAction', 'target' => array('@type' => 'EntryPoint', 'urlTemplate' => $p['search']), 'query-input' => 'required name=search_term_string');
        }
        return $node;
    }

    /** $items: list of array(name, url) from the home page to the current page. */
    public static function breadcrumb_node($items) {
        $list = array();
        foreach (array_values($items) as $i => $it) {
            $list[] = array('@type' => 'ListItem', 'position' => $i + 1, 'name' => $it[0], 'item' => $it[1]);
        }
        $last = end($items);
        return array('@type' => 'BreadcrumbList', '@id' => $last[1] . '#breadcrumb', 'itemListElement' => $list);
    }

    private static function number($v) {
        return (float) $v == (int) $v ? (int) $v : (float) $v;
    }

    /**
     * OfferShippingDetails for one offer price: per zone, the lowest rate a buyer of this one item can choose. With
     * no single price (a range), a zone whose free shipping depends on the order amount is left out: not exact.
     */
    public static function shipping_details($p, $price) {
        $out = array();
        foreach ($p['zones'] as $z) {
            if ($price === null && in_array('free_min', array_column($z['rates'], 'type'), true)) {
                continue;
            }
            $rates = array();
            foreach ($z['rates'] as $r) {
                if ($r['type'] === 'flat') {
                    $rates[] = (float) $r['cost'];
                } elseif ($r['type'] === 'free' || ($r['type'] === 'free_min' && $price !== null && (float) $price >= (float) $r['min'])) {
                    $rates[] = 0.0;
                }
            }
            if (!$rates) {
                continue;
            }
            $dest = array('@type' => 'DefinedRegion', 'addressCountry' => $z['country']);
            if (!empty($z['region'])) {
                $dest['addressRegion'] = $z['region'];
            }
            $d = array('@type' => 'OfferShippingDetails', 'shippingRate' => array('@type' => 'MonetaryAmount', 'value' => self::number(min($rates)), 'currency' => $p['currency']), 'shippingDestination' => $dest);
            if (!empty($z['delivery'])) {
                $qv = function ($r) { return array('@type' => 'QuantitativeValue', 'minValue' => $r[0], 'maxValue' => $r[1], 'unitCode' => 'DAY'); };
                $d['deliveryTime'] = array('@type' => 'ShippingDeliveryTime', 'handlingTime' => $qv($z['delivery']['handling']), 'transitTime' => $qv($z['delivery']['transit']));
            }
            $out[] = $d;
        }
        return $out;
    }

    public static function return_policy($p) {
        $node = array('@type' => 'MerchantReturnPolicy', 'applicableCountry' => count($p['countries']) === 1 ? $p['countries'][0] : $p['countries'], 'returnPolicyCategory' => 'https://schema.org/' . $p['category']);
        if (isset($p['days'])) {
            $node['merchantReturnDays'] = $p['days'];
        }
        if (isset($p['method'])) {
            $node['returnMethod'] = 'https://schema.org/' . $p['method'];
        }
        if (isset($p['fees'])) {
            $node['returnFees'] = 'https://schema.org/' . $p['fees'];
        }
        if (isset($p['link'])) {
            $node['merchantReturnLink'] = $p['link'];
        }
        return $node;
    }

    /** $variations: list of array(price, availability (schema.org member), url, sku, gtin). */
    public static function variant_offers($variations, $currency) {
        $out = array();
        foreach (array_slice($variations, 0, self::MAX_VARIANTS) as $v) {
            if ($v['price'] === '' || $v['price'] === null) {
                continue;
            }
            $o = array('@type' => 'Offer', 'price' => (string) $v['price'], 'priceCurrency' => $currency, 'availability' => 'https://schema.org/' . $v['availability'], 'url' => $v['url']);
            if (!empty($v['sku'])) {
                $o['sku'] = (string) $v['sku'];
            }
            if (!empty($v['gtin'])) {
                $o['gtin'] = (string) $v['gtin'];
            }
            $out[] = $o;
        }
        return $out;
    }

    /**
     * Pure: a Product node with its offers extended. $ctx: ship (callable price → details, or null), returns (node or
     * null), org_id (string or null), variants (list of Offer or null). Existing values are kept as they are.
     */
    public static function extend_product($node, $ctx) {
        if (!is_array($node) || empty($node['offers'])) {
            return $node;
        }
        $single = isset($node['offers']['@type']);
        $offers = $single ? array($node['offers']) : $node['offers'];
        $add = function ($o, $price) use ($ctx) {
            if (!empty($ctx['ship']) && !isset($o['shippingDetails'])) {
                $d = call_user_func($ctx['ship'], $price);
                if ($d) {
                    $o['shippingDetails'] = $d;
                }
            }
            if (!empty($ctx['returns']) && !isset($o['hasMerchantReturnPolicy'])) {
                $o['hasMerchantReturnPolicy'] = $ctx['returns'];
            }
            if (!empty($ctx['org_id']) && isset($o['seller']) && is_array($o['seller']) && !isset($o['seller']['@id'])) {
                $o['seller']['@id'] = $ctx['org_id'];
            }
            return $o;
        };
        foreach ($offers as $i => $o) {
            if (!is_array($o)) {
                continue;
            }
            $variants = !empty($ctx['variants']) ? $ctx['variants'] : null;
            if ($variants && !isset($o['offers'])) {
                if (($o['@type'] ?? '') === 'Offer') {
                    $prices = array_map(function ($v) { return (float) $v['price']; }, $variants);
                    $o['@type'] = 'AggregateOffer';
                    $o['lowPrice'] = (string) min($prices);
                    $o['highPrice'] = (string) max($prices);
                    $o['offerCount'] = count($variants);
                }
                $o['offers'] = array_map(function ($v) use ($add) { return $add($v, $v['price']); }, $variants);
                // Without one price, a rate that depends on the price stays on each variation's own offer.
                $offers[$i] = $add($o, null);
                continue;
            }
            $price = $o['price'] ?? ($o['lowPrice'] ?? null);
            $offers[$i] = $add($o, ($o['@type'] ?? '') === 'AggregateOffer' && ($o['lowPrice'] ?? null) !== ($o['highPrice'] ?? null) ? null : $price);
        }
        $node['offers'] = $single ? $offers[0] : $offers;
        return $node;
    }

    // ---- Page loads (thin: read the store's own data, call the pure functions) -----------------------------

    private static function fix($kind) {
        $f = AGSC_Fixes::of_kind($kind);
        return $f ? reset($f) : null;
    }

    /** Yoast SEO and Rank Math output their own Organization, WebSite and BreadcrumbList. */
    public static function seo_plugin() {
        return defined('WPSEO_VERSION') ? 'yoast' : ((defined('RANK_MATH_VERSION') || class_exists('RankMath')) ? 'rankmath' : '');
    }

    private static function site() {
        $logo = '';
        $logo_id = (int) get_theme_mod('custom_logo');
        if ($logo_id) {
            $logo = (string) wp_get_attachment_image_url($logo_id, 'full');
        }
        if ($logo === '' && function_exists('get_site_icon_url')) {
            $logo = (string) get_site_icon_url(512);
        }
        return array('name' => wp_strip_all_tags(get_bloginfo('name')), 'url' => home_url('/'), 'logo' => $logo);
    }

    private static function context($product) {
        $ctx = array('ship' => null, 'returns' => null, 'org_id' => null, 'variants' => null);
        if (!is_object($product)) {
            return $ctx;
        }
        $ship = self::fix('shipping');
        if ($ship && method_exists($product, 'needs_shipping') && $product->needs_shipping() && $ship['payload']['currency'] === get_woocommerce_currency()) {
            $payload = $ship['payload'];
            $ctx['ship'] = function ($price) use ($payload) { return AGSC_Schema::shipping_details($payload, $price); };
        }
        $returns = self::fix('returns');
        if ($returns) {
            $ctx['returns'] = self::return_policy($returns['payload']);
        }
        if (self::fix('org')) {
            $ctx['org_id'] = self::org_id(home_url('/'));
        }
        if (self::fix('variants') && $product->is_type('variable')) {
            $rows = array();
            foreach (array_slice($product->get_children(), 0, self::MAX_VARIANTS) as $child_id) {
                $v = wc_get_product($child_id);
                if (!$v || !$v->is_purchasable() || $v->get_status() !== 'publish') {
                    continue;
                }
                $stock = $v->get_stock_status();
                $gtin = method_exists($v, 'get_global_unique_id') ? (string) $v->get_global_unique_id() : '';
                $rows[] = array(
                    'price'        => $v->get_price(),
                    'availability' => $stock === 'outofstock' ? 'OutOfStock' : ($stock === 'onbackorder' ? 'BackOrder' : 'InStock'),
                    'url'          => $v->get_permalink(),
                    'sku'          => $v->get_sku(),
                    'gtin'         => preg_match('/^\d{8}(\d{4,6})?$/', $gtin) ? $gtin : '',
                );
            }
            $ctx['variants'] = self::variant_offers($rows, get_woocommerce_currency());
        }
        return $ctx;
    }

    /** WooCommerce core's Product node (same @id: permalink#product). */
    public static function extend_wc_product($markup, $product) {
        return self::extend_product($markup, self::context($product));
    }

    /** Yoast WooCommerce SEO and Rank Math Product entities, on the product page being shown. */
    public static function extend_graph_product($node) {
        $id = function_exists('get_queried_object_id') ? (int) get_queried_object_id() : 0;
        if (!$id || !function_exists('wc_get_product')) {
            return $node;
        }
        return self::extend_product($node, self::context(wc_get_product($id)));
    }

    /** Types WooCommerce already collected for this page (BreadcrumbList, WebSite, ...). */
    private static function wc_types() {
        $types = array();
        if (function_exists('WC') && isset(WC()->structured_data) && is_array(WC()->structured_data->get_data())) {
            foreach (WC()->structured_data->get_data() as $node) {
                foreach ((array) ($node['@type'] ?? array()) as $t) {
                    $types[] = $t;
                }
            }
        }
        return $types;
    }

    private static function breadcrumb_items() {
        $items = array(array(__('Home', 'woocommerce'), home_url('/')));
        $term = null;
        $last = null;
        if (function_exists('is_product') && is_product()) {
            $id = (int) get_queried_object_id();
            $terms = wc_get_product_terms($id, 'product_cat', array('orderby' => 'parent', 'order' => 'DESC'));
            $term = $terms ? $terms[0] : null;
            $last = array(wp_strip_all_tags(get_the_title($id)), get_permalink($id));
        } elseif (function_exists('is_product_category') && is_product_category()) {
            $term = get_queried_object();
        } else {
            return null;
        }
        if ($term) {
            foreach (array_reverse(get_ancestors($term->term_id, 'product_cat')) as $ancestor_id) {
                $a = get_term($ancestor_id, 'product_cat');
                if ($a && !is_wp_error($a)) {
                    $items[] = array(wp_strip_all_tags($a->name), get_term_link($a));
                }
            }
            $items[] = array(wp_strip_all_tags($term->name), get_term_link($term));
        }
        if ($last) {
            $items[] = $last;
        }
        return count($items) > 1 ? $items : null;
    }

    public static function output() {
        if (self::seo_plugin() !== '') {
            return;
        }
        $nodes = array();
        $wc = self::wc_types();
        $site = self::site();
        $org = self::fix('org');
        if (is_front_page() && $org) {
            $nodes[] = self::org_node($site, $org['payload']);
        }
        $website = self::fix('website');
        if (is_front_page() && $website && !in_array('WebSite', $wc, true)) {
            $nodes[] = self::website_node($site, $website['payload'], (bool) $org);
        }
        if (self::fix('breadcrumbs') && !in_array('BreadcrumbList', $wc, true)) {
            $items = self::breadcrumb_items();
            if ($items) {
                $nodes[] = self::breadcrumb_node($items);
            }
        }
        if ($nodes) {
            echo self::script($nodes); // phpcs:ignore WordPress.Security.EscapeOutput -- JSON encoded with JSON_HEX_TAG | JSON_HEX_AMP.
        }
    }

    /** Pure: one JSON-LD script; JSON_HEX_TAG | JSON_HEX_AMP keep "</script>" and "&" out of the markup. */
    public static function script($nodes) {
        return '<script type="application/ld+json" class="agentscope-schema">' . wp_json_encode(array('@context' => 'https://schema.org', '@graph' => array_values($nodes)), JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . '</script>';
    }
}
