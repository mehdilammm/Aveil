<?php
/**
 * Plugin Name:       AgentScope Core
 * Description:       Read-only WooCommerce store readiness checks and opt-in, privacy-conscious AI traffic signals. User agents and referrers are recorded as unverified claims, never as proven identity.
 * Version:           1.3.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            AgentScope
 * License:           GPLv2 or later
 * Text Domain:       agentscope-core
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AGSC_VERSION', '1.3.0');
define('AGSC_DB_VERSION', '1');
define('AGSC_FILE', __FILE__);
define('AGSC_DIR', plugin_dir_path(__FILE__));
define('AGSC_URL', plugin_dir_url(__FILE__));

require_once AGSC_DIR . 'includes/class-agsc-settings.php';
require_once AGSC_DIR . 'includes/class-agsc-signals.php';
require_once AGSC_DIR . 'includes/class-agsc-check.php';
require_once AGSC_DIR . 'includes/class-agsc-burst.php';
require_once AGSC_DIR . 'includes/class-agsc-traffic.php';
require_once AGSC_DIR . 'includes/class-agsc-sender.php';
require_once AGSC_DIR . 'includes/class-agsc-readiness.php';
require_once AGSC_DIR . 'includes/class-agsc-rest.php';
require_once AGSC_DIR . 'includes/class-agsc-admin.php';
// Updates from the AgentScope app; absent from a WordPress.org build, where WordPress.org delivers updates.
if (file_exists(AGSC_DIR . 'includes/class-agsc-updater.php')) {
    require_once AGSC_DIR . 'includes/class-agsc-updater.php';
}

register_activation_hook(__FILE__, array('AGSC_Traffic', 'activate'));
register_deactivation_hook(__FILE__, 'agsc_deactivate');

add_action('plugins_loaded', 'agsc_bootstrap');

function agsc_deactivate() {
    AGSC_Traffic::deactivate();
    AGSC_Sender::deactivate();
}

function agsc_bootstrap() {
    AGSC_Traffic::maybe_upgrade();
    AGSC_Traffic::init();
    AGSC_Sender::init();
    AGSC_Rest::init();
    if (class_exists('AGSC_Updater')) {
        AGSC_Updater::init();
    }
    if (is_admin()) {
        AGSC_Admin::init();
    }
}
