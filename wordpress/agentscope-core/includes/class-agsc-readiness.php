<?php
/**
 * Read-only WooCommerce readiness scan.
 * Reads product and page fields only. Never edits products and never reads orders, customers or payment data.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Readiness {
    const CURRENT      = 'agsc_scan_current';
    const HISTORY      = 'agsc_scan_history';
    const MAX_HISTORY  = 30;
    const PAGE_SIZE    = 50;
    const MAX_PRODUCTS = 2000;
    const DESC_MIN     = 80;

    private static function finding($id, $type, $title, $severity, $evidence, $guidance, $product_id = 0, $basis = 'observed') {
        $product_id = (int) $product_id;
        return array(
            'id'         => $id,
            'type'       => $type,
            'title'      => $title,
            'severity'   => $severity,
            'evidence'   => $evidence,
            'guidance'   => $guidance,
            'product_id' => $product_id,
            'edit_url'   => $product_id ? admin_url('post.php?post=' . $product_id . '&action=edit') : '',
            'basis'      => $basis,
        );
    }

    public static function severity_rank($severity) {
        $ranks = array('high' => 0, 'medium' => 1, 'low' => 2);
        return isset($ranks[$severity]) ? $ranks[$severity] : 3;
    }

    public static function scan() {
        if (!function_exists('wc_get_products') || !function_exists('wc_get_page_id')) {
            return array('status' => 'unavailable', 'error' => 'WooCommerce is not active. No scan was run.');
        }
        $started = microtime(true);
        $findings = array();
        $scanned = 0;
        $capped = false;
        $counts = wp_count_posts('product');
        $published = (is_object($counts) && isset($counts->publish)) ? (int) $counts->publish : 0;

        $page = 1;
        do {
            $batch = wc_get_products(array(
                'status'  => 'publish',
                'limit'   => self::PAGE_SIZE,
                'page'    => $page,
                'orderby' => 'ID',
                'order'   => 'ASC',
            ));
            if (!is_array($batch) || empty($batch)) {
                break;
            }
            foreach ($batch as $product) {
                if ($scanned >= self::MAX_PRODUCTS) {
                    $capped = true;
                    break 2;
                }
                if (!is_object($product) || !is_a($product, 'WC_Product')) {
                    continue;
                }
                $scanned++;
                foreach (self::check_product($product) as $finding) {
                    $findings[] = $finding;
                }
            }
            $page++;
        } while (count($batch) === self::PAGE_SIZE);

        foreach (self::check_pages() as $finding) {
            $findings[] = $finding;
        }

        if ($capped || $scanned < $published) {
            $findings[] = self::finding(
                'coverage-limit', 'coverage',
                'Scan did not cover every product', 'high',
                $scanned . ' of ' . $published . ' published products were scanned.',
                'Results only describe the scanned products. Large catalogs need a batched scan.'
            );
        }

        usort($findings, array(__CLASS__, 'compare_findings'));

        $ids = array();
        foreach ($findings as $finding) {
            $ids[] = $finding['id'];
        }

        return array(
            'status'             => 'complete',
            'data_label'         => 'OBSERVED',
            'created_utc'        => gmdate('Y-m-d H:i:s'),
            'duration_ms'        => (int) round((microtime(true) - $started) * 1000),
            'published_products' => $published,
            'scanned_products'   => $scanned,
            'findings_count'     => count($findings),
            'severity_counts'    => self::severity_counts($findings),
            'finding_ids'        => $ids,
            'findings'           => $findings,
            'limitations'        => 'Read-only database field checks. No agent browsing, HTTP check, real purchase, delivery, legal review or AI ranking was tested. Rules marked heuristic are judgement calls.',
        );
    }

    public static function compare_findings($a, $b) {
        $diff = self::severity_rank($a['severity']) - self::severity_rank($b['severity']);
        if ($diff !== 0) {
            return $diff;
        }
        return strcmp($a['id'], $b['id']);
    }

    private static function severity_counts($findings) {
        $counts = array('high' => 0, 'medium' => 0, 'low' => 0);
        foreach ($findings as $finding) {
            if (isset($counts[$finding['severity']])) {
                $counts[$finding['severity']]++;
            }
        }
        return $counts;
    }

    private static function check_product($product) {
        $out = array();
        $id = (int) $product->get_id();
        $name = wp_strip_all_tags((string) $product->get_name());
        $ref = $name . ' (#' . $id . ')';

        foreach (self::check_price($product, $id, $ref) as $finding) {
            $out[] = $finding;
        }

        $description = trim(wp_strip_all_tags((string) $product->get_description()));
        $length = function_exists('mb_strlen') ? mb_strlen($description) : strlen($description);
        if ($length < self::DESC_MIN) {
            $out[] = self::finding(
                'p' . $id . '-description', 'description',
                $ref . ': description is short', 'low',
                'Description is ' . $length . ' characters (rule of thumb: ' . self::DESC_MIN . ').',
                'Add verified specifications and real product details. Length alone does not prove quality.',
                $id, 'heuristic'
            );
        }

        $image_id = (int) $product->get_image_id();
        if (!$image_id) {
            $out[] = self::finding(
                'p' . $id . '-image', 'image',
                $ref . ': no featured image', 'medium',
                'No featured product image is attached.',
                'Add an accurate photo of the real product with alt text.',
                $id
            );
        } elseif (!wp_attachment_is_image($image_id)) {
            $out[] = self::finding(
                'p' . $id . '-image-broken', 'image',
                $ref . ': featured image is not a valid image', 'medium',
                'Featured image ID ' . $image_id . ' is not an image attachment in the media library.',
                'Replace the featured image with a real image file.',
                $id
            );
        }

        if (!$product->is_type('variable') && $product->needs_shipping()) {
            $weight = (string) $product->get_weight();
            if ($weight === '' || (float) $weight <= 0) {
                $out[] = self::finding(
                    'p' . $id . '-weight', 'weight',
                    $ref . ': shipping weight missing', 'medium',
                    'Physical product with an empty or zero weight.',
                    'Weigh the packed product and enter it in the store weight unit.',
                    $id
                );
            }
        }

        if ($product->managing_stock()) {
            $qty = $product->get_stock_quantity();
            $status = (string) $product->get_stock_status();
            $backorders = $product->backorders_allowed();
            $problem = false;
            if ($qty === null) {
                $problem = true;
            } elseif (!$backorders && $qty > 0 && $status === 'outofstock') {
                $problem = true;
            } elseif (!$backorders && $qty <= 0 && $status === 'instock') {
                $problem = true;
            }
            if ($problem) {
                $out[] = self::finding(
                    'p' . $id . '-stock', 'stock',
                    $ref . ': stock status does not match quantity', 'high',
                    'Quantity: ' . ($qty === null ? 'unknown' : (int) $qty) . '; status: ' . $status . '; backorders: ' . ($backorders ? 'allowed' : 'not allowed') . '.',
                    'Check real inventory, then correct quantity, status or backorder rules.',
                    $id
                );
            }
        }

        return $out;
    }

    private static function check_price($product, $id, $ref) {
        $out = array();
        if ($product->is_type('grouped')) {
            return $out;
        }

        if ($product->is_type('variable')) {
            $prices = $product->get_variation_prices(true);
            $list = (isset($prices['price']) && is_array($prices['price'])) ? $prices['price'] : array();
            if (empty($list)) {
                $out[] = self::finding(
                    'p' . $id . '-price', 'price',
                    $ref . ': no variation has a price', 'high',
                    'No purchasable variation has an active price.',
                    'Enter verified prices for the variations in the product editor.',
                    $id
                );
                return $out;
            }
            $zero = array();
            foreach ($list as $variation_id => $value) {
                if ((float) $value <= 0) {
                    $zero[] = (int) $variation_id;
                }
            }
            if (count($zero) === count($list)) {
                $out[] = self::finding(
                    'p' . $id . '-price-zero', 'price',
                    $ref . ': every variation costs 0', 'medium',
                    'All ' . count($list) . ' variation prices are 0. This may be intentional for a free product.',
                    'Confirm the product is meant to be free, or enter the correct verified prices. AgentScope never changes prices.',
                    $id
                );
            } elseif (!empty($zero)) {
                $out[] = self::finding(
                    'p' . $id . '-price-zero-variations', 'price',
                    $ref . ': some variations cost 0', 'medium',
                    'Variations with price 0: ' . implode(', ', array_slice($zero, 0, 20)) . (count($zero) > 20 ? ' and more' : '') . '.',
                    'Confirm these variations are meant to be free, or enter verified prices.',
                    $id
                );
            }
            return $out;
        }

        $price = (string) $product->get_price();
        if ($price === '') {
            $out[] = self::finding(
                'p' . $id . '-price', 'price',
                $ref . ': price missing', 'high',
                'The active price is empty, so the product cannot be bought.',
                'Enter a verified price in the product editor.',
                $id
            );
        } elseif (!is_numeric($price)) {
            $out[] = self::finding(
                'p' . $id . '-price-invalid', 'price',
                $ref . ': price is not a number', 'high',
                'The active price is stored as "' . substr($price, 0, 30) . '".',
                'Re-enter the price as a number in the product editor.',
                $id
            );
        } elseif ((float) $price < 0) {
            $out[] = self::finding(
                'p' . $id . '-price-negative', 'price',
                $ref . ': price is negative', 'high',
                'The active price is ' . $price . '.',
                'Enter a verified price of zero or more.',
                $id
            );
        } elseif ((float) $price == 0.0) {
            $out[] = self::finding(
                'p' . $id . '-price-zero', 'price',
                $ref . ': price is 0', 'medium',
                'The active price is 0. This may be intentional for a free product.',
                'Confirm the product is meant to be free, or enter the correct verified price. AgentScope never changes prices.',
                $id
            );
        }

        $regular = (string) $product->get_regular_price();
        $sale = (string) $product->get_sale_price();
        if ($regular !== '' && $sale !== '' && is_numeric($regular) && is_numeric($sale) && (float) $sale >= (float) $regular) {
            $out[] = self::finding(
                'p' . $id . '-sale', 'price',
                $ref . ': sale price is not lower than regular price', 'high',
                'Sale price ' . $sale . ' vs regular price ' . $regular . '.',
                'Review the sale price before the product is shown as discounted.',
                $id
            );
        }
        return $out;
    }

    private static function check_pages() {
        $out = array();
        $wc_pages = array('shop' => 'Shop', 'cart' => 'Cart', 'checkout' => 'Checkout');
        foreach ($wc_pages as $slug => $label) {
            $page_id = (int) wc_get_page_id($slug);
            if ($page_id <= 0 || get_post_status($page_id) !== 'publish') {
                $out[] = self::finding(
                    'page-' . $slug, 'page',
                    $label . ' page is not assigned or not published', 'high',
                    'Assigned page: ' . ($page_id > 0 ? $page_id : 'none') . '; status: ' . ($page_id > 0 ? (get_post_status($page_id) ?: 'missing') : 'unassigned') . '.',
                    'Assign and publish the page under WooCommerce > Settings > Advanced.'
                );
            }
        }
        $policies = array(
            'policy-privacy' => array('Privacy policy', (int) get_option('wp_page_for_privacy_policy'), 'Settings > Privacy'),
            'policy-returns' => array('Returns policy', (int) get_option('woocommerce_refund_returns_page_id'), 'WooCommerce > Settings > Advanced'),
            'policy-terms'   => array('Terms and conditions', (int) get_option('woocommerce_terms_page_id'), 'WooCommerce > Settings > Advanced'),
        );
        foreach ($policies as $key => $policy) {
            $page_id = $policy[1];
            if (!$page_id || get_post_status($page_id) !== 'publish') {
                $out[] = self::finding(
                    $key, 'policy',
                    $policy[0] . ' page is not published', 'medium',
                    $page_id ? 'Page ' . $page_id . ' is assigned with status: ' . (get_post_status($page_id) ?: 'missing') . '.' : 'No page is assigned.',
                    'Write a policy that matches how the store really works, publish it and assign it under ' . $policy[2] . '. This is not legal advice.'
                );
            }
        }
        return $out;
    }

    /**
     * Saves the scan, tags each finding as new, ongoing or recurred, and keeps the last 30 scans.
     */
    public static function save($scan) {
        if (!is_array($scan) || !isset($scan['status']) || $scan['status'] !== 'complete') {
            return false;
        }
        $history = get_option(self::HISTORY, array());
        if (!is_array($history)) {
            $history = array();
        }
        $previous = empty($history) ? null : $history[count($history) - 1];
        $previous_ids = $previous ? (array) $previous['finding_ids'] : array();
        $earlier_ids = array();
        for ($i = 0; $i < count($history) - 1; $i++) {
            foreach ((array) $history[$i]['finding_ids'] as $old_id) {
                $earlier_ids[$old_id] = true;
            }
        }

        $new_ids = array();
        $recurred_ids = array();
        foreach ($scan['findings'] as $index => $finding) {
            $fid = $finding['id'];
            if (!$previous) {
                $state = 'new';
            } elseif (in_array($fid, $previous_ids, true)) {
                $state = 'ongoing';
            } elseif (isset($earlier_ids[$fid])) {
                $state = 'recurred';
                $recurred_ids[] = $fid;
            } else {
                $state = 'new';
                $new_ids[] = $fid;
            }
            $scan['findings'][$index]['state'] = $state;
        }
        $resolved_ids = $previous ? array_values(array_diff($previous_ids, $scan['finding_ids'])) : array();

        $scan['comparison'] = array(
            'first_run'         => !$previous,
            'previous_scan_utc' => $previous ? $previous['created_utc'] : null,
            'new_ids'           => $new_ids,
            'resolved_ids'      => $resolved_ids,
            'recurred_ids'      => $recurred_ids,
            'note'              => 'A finding is resolved when its field rule passes on a later scan. This does not prove AI agents can buy from the store.',
        );

        $history[] = array(
            'created_utc'      => $scan['created_utc'],
            'scanned_products' => $scan['scanned_products'],
            'findings_count'   => $scan['findings_count'],
            'severity_counts'  => $scan['severity_counts'],
            'resolved_count'   => count($resolved_ids),
            'new_count'        => count($new_ids) + count($recurred_ids),
            'finding_ids'      => $scan['finding_ids'],
        );
        if (count($history) > self::MAX_HISTORY) {
            $history = array_slice($history, -self::MAX_HISTORY);
        }
        update_option(self::HISTORY, $history, false);
        update_option(self::CURRENT, $scan, false);
        return $scan;
    }

    public static function run_and_save() {
        $scan = self::scan();
        $saved = self::save($scan);
        return $saved ? $saved : $scan;
    }

    public static function current() {
        $scan = get_option(self::CURRENT, array());
        if (is_array($scan) && isset($scan['status'])) {
            return $scan;
        }
        return array('status' => 'not-scanned', 'message' => 'No scan has run yet.');
    }

    /** History without the long id lists, newest first. */
    public static function history_brief() {
        $history = get_option(self::HISTORY, array());
        if (!is_array($history)) {
            return array();
        }
        $brief = array();
        foreach (array_reverse($history) as $row) {
            unset($row['finding_ids']);
            $brief[] = $row;
        }
        return $brief;
    }
}
