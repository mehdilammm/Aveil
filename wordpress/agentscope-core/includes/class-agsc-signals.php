<?php
/**
 * Classifies a self-declared user agent or a referrer host.
 * A match is a claim, never a verified identity. No personal identifiers are returned.
 */
if (!defined('ABSPATH')) {
    exit;
}

final class AGSC_Signals {

    private static function bot_rules() {
        return array(
            array('pattern' => '~(?:^|[^a-z0-9])ChatGPT-User(?:/|\b)~i', 'source' => 'OpenAI', 'category' => 'agent-retrieval'),
            array('pattern' => '~(?:^|[^a-z0-9])OAI-SearchBot(?:/|\b)~i', 'source' => 'OpenAI', 'category' => 'search-crawler'),
            array('pattern' => '~(?:^|[^a-z0-9])GPTBot(?:/|\b)~i', 'source' => 'OpenAI', 'category' => 'crawler'),
            array('pattern' => '~(?:^|[^a-z0-9])Claude-User(?:/|\b)~i', 'source' => 'Anthropic', 'category' => 'agent-retrieval'),
            array('pattern' => '~(?:^|[^a-z0-9])Claude-SearchBot(?:/|\b)~i', 'source' => 'Anthropic', 'category' => 'search-crawler'),
            array('pattern' => '~(?:^|[^a-z0-9])ClaudeBot(?:/|\b)~i', 'source' => 'Anthropic', 'category' => 'crawler'),
            array('pattern' => '~(?:^|[^a-z0-9])anthropic-ai(?:/|\b)~i', 'source' => 'Anthropic', 'category' => 'crawler'),
            array('pattern' => '~(?:^|[^a-z0-9])Perplexity-User(?:/|\b)~i', 'source' => 'Perplexity', 'category' => 'agent-retrieval'),
            array('pattern' => '~(?:^|[^a-z0-9])PerplexityBot(?:/|\b)~i', 'source' => 'Perplexity', 'category' => 'crawler'),
        );
    }

    private static function referral_rules() {
        return array(
            'OpenAI'            => array('chatgpt.com', 'chat.openai.com'),
            'Anthropic'         => array('claude.ai'),
            'Perplexity'        => array('perplexity.ai'),
            'Google Gemini'     => array('gemini.google.com'),
            'Microsoft Copilot' => array('copilot.microsoft.com'),
        );
    }

    /**
     * @return array|null array('source','category','confidence') or null when nothing matches.
     */
    public static function classify($user_agent, $referrer) {
        $ua = substr((string) $user_agent, 0, 512);
        foreach (self::bot_rules() as $rule) {
            if (preg_match($rule['pattern'], $ua)) {
                return array(
                    'source'     => $rule['source'],
                    'category'   => $rule['category'],
                    'confidence' => 'unverified-user-agent',
                );
            }
        }
        $host = wp_parse_url((string) $referrer, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            return null;
        }
        $host = strtolower(rtrim($host, '.'));
        foreach (self::referral_rules() as $source => $domains) {
            foreach ($domains as $domain) {
                $suffix = '.' . $domain;
                if ($host === $domain || substr($host, -strlen($suffix)) === $suffix) {
                    return array(
                        'source'     => $source,
                        'category'   => 'human-ai-referral',
                        'confidence' => 'unverified-referrer',
                    );
                }
            }
        }
        return null;
    }

    /**
     * Synthetic header strings processed locally. Results are never written to traffic data.
     */
    public static function self_test() {
        $browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
        $cases = array(
            array('OpenAI training crawler', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot', '', 'OpenAI/crawler'),
            array('OpenAI search crawler', 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', '', 'OpenAI/search-crawler'),
            array('OpenAI user retrieval', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', '', 'OpenAI/agent-retrieval'),
            array('Anthropic crawler', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', '', 'Anthropic/crawler'),
            array('Anthropic search crawler', 'Mozilla/5.0 (compatible; Claude-SearchBot/1.0)', '', 'Anthropic/search-crawler'),
            array('Anthropic user retrieval', 'Mozilla/5.0 (compatible; Claude-User/1.0)', '', 'Anthropic/agent-retrieval'),
            array('Perplexity crawler', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0)', '', 'Perplexity/crawler'),
            array('Perplexity user retrieval', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0)', '', 'Perplexity/agent-retrieval'),
            array('ChatGPT browser referral', $browser, 'https://chatgpt.com/', 'OpenAI/human-ai-referral'),
            array('Claude browser referral', $browser, 'https://claude.ai/chat/abc', 'Anthropic/human-ai-referral'),
            array('Perplexity browser referral', $browser, 'https://www.perplexity.ai/search?q=x', 'Perplexity/human-ai-referral'),
            array('Gemini browser referral', $browser, 'https://gemini.google.com/app', 'Google Gemini/human-ai-referral'),
            array('Copilot browser referral', $browser, 'https://copilot.microsoft.com/', 'Microsoft Copilot/human-ai-referral'),
            array('Unrelated browser', $browser, 'https://www.google.com/', 'none'),
            array('Lookalike referral', $browser, 'https://fake-chatgpt.com/', 'none'),
            array('Spoofed parent domain', $browser, 'https://claude.ai.evil.example/', 'none'),
            array('No user agent and no referral', '', '', 'none'),
            array('Declared user agent beats referral', 'GPTBot/1.2', 'https://claude.ai/', 'OpenAI/crawler'),
        );
        $results = array();
        $passed = 0;
        foreach ($cases as $case) {
            $match = self::classify($case[1], $case[2]);
            $actual = $match ? $match['source'] . '/' . $match['category'] : 'none';
            $ok = ($actual === $case[3]);
            if ($ok) {
                $passed++;
            }
            $results[] = array('case' => $case[0], 'expected' => $case[3], 'actual' => $actual, 'pass' => $ok);
        }
        return array(
            'data_label'  => 'SYNTHETIC',
            'passed'      => $passed,
            'total'       => count($cases),
            'cases'       => $results,
            'limitations' => 'Synthetic header strings checked in PHP only. No real request, identity verification, CDN capture or purchase was tested. Never counted as observed traffic.',
        );
    }
}
