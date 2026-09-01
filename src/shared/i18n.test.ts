import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LANGUAGE, isAppLanguage, t } from './i18n'

test('default language is Chinese', () => {
  assert.equal(DEFAULT_LANGUAGE, 'zh')
  assert.equal(t(undefined, 'settings'), '设置')
  assert.equal(t('zh', 'homeTitle'), 'VesPi')
})

test('English is an explicit opt-in', () => {
  assert.equal(t('en', 'settings'), 'Settings')
  assert.equal(t('en', 'newSession'), 'New Session')
})

test('unknown values fall back to Chinese', () => {
  assert.equal(isAppLanguage('fr'), false)
  assert.equal(t('nope' as never, 'chat'), '对话')
})

test('placeholders interpolate', () => {
  assert.equal(t('zh', 'newSessionIn', { name: 'dp' }), '在 dp 中')
})
