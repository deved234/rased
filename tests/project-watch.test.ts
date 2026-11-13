import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  WATCH_ENABLED,
  WATCH_OFFERS_PAGE_CAP,
  WATCH_SOURCES,
  contactAttribution,
  type WatchSnapshot,
  type WatchSource
} from '../src/shared/projectWatch.js'
import { parseWatchPage } from '../src/collector/projectWatch.js'
import { parseProjectFacts } from '../src/collector/projectFacts.js'

interface Reply { status?: number; finalUrl?: string }

const read = (name: string): string => readFileSync(`tests/fixtures/watch/${name}`, 'utf8')

function snapshotOf(html: string, source: WatchSource, response?: Reply): WatchSnapshot {
  const page = parseWatchPage(html, source, response)
  if (page.kind !== 'snapshot') throw new Error(`expected a snapshot, received ${page.kind}`)
  return page.snapshot
}

// Synthetic panel shells: only the labeled rows the parser is allowed to trust.
const metaPanel = (...rows: string[]): string => `<div id="project-meta-panel"><div class="meta-rows">${rows.join('')}</div></div>`
const metaRow = (label: string, value: string): string => `<div class="meta-row"><div class="meta-label" title="">${label}</div><div class="meta-value" title="">${value}</div></div>`
const bidsPanel = (...items: string[]): string => `<div id="bidsCollection-panel">${items.join('')}</div>`
const bid = (id: number): string => `<div class="bid" data-bid-item="${id}"></div>`
const nafezlyCard = (...rows: string[]): string => `<div class="mb-1"> بطاقة المشروع </div><div class="col-12 row p-3">${rows.join('')}</div>`
const nafezlyRow = (label: string, value: string): string => `<div class="col-12 row"><div class="col-6 col-md-7 text-right p-1">${label}</div><div class="col-6 col-md-5 px-0 p-1 font-1">${value}</div></div>`
const kafStep = (title: string | null): string =>
  `<div class="steps-container"><div class="step current">${title === null ? '' : `<span class="title">${title}</span>`}</div></div>`
const kafHead = '<div class="block-head"><p class="title"><i class="fas fa-list-alt"></i> معلومات المشروع </p></div>'
const kafInfoRow = (label: string, value: string): string => `<tr><td><i class="fas"></i>${label}</td><td>${value}</td></tr>`
const kafInfo = (...rows: string[]): string => `${kafHead}<div class="block-body"><table class="info-table">${rows.join('')}</table></div>`
const emptySnapshot: WatchSnapshot = { status: null, offers: null, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null }

describe('Watch contract stays dormant', () => {
  it('ships disabled and limited to the three supported sources', () => {
    expect(WATCH_ENABLED).toBe(false)
    expect(WATCH_SOURCES).toEqual(['mostaql', 'nafezly', 'kaf'])
    expect(WATCH_OFFERS_PAGE_CAP).toBe(50)
  })
})

describe('Mostaql watch snapshots', () => {
  it('reads an open project whose client is idle elsewhere', () => {
    expect(snapshotOf(read('mostaql-open-sure.html'), 'mostaql')).toEqual({
      status: 'open', offers: 7, offersCapped: false, contacts: 1, clientOpen: 1, clientInProgress: 0
    })
  })
  it('reads a busy client with 25 offers', () => {
    expect(snapshotOf(read('mostaql-open-contacts.html'), 'mostaql')).toEqual({
      status: 'open', offers: 25, offersCapped: false, contacts: 4, clientOpen: 1, clientInProgress: 0
    })
  })
  it('reads the processing label class and the client table', () => {
    expect(snapshotOf(read('mostaql-processing.html'), 'mostaql')).toEqual({
      status: 'in_progress', offers: 2, offersCapped: false, contacts: 2, clientOpen: 0, clientInProgress: 1
    })
  })
  it('reads a closed project even though the label text carries a diacritic', () => {
    expect(snapshotOf(read('mostaql-closed.html'), 'mostaql')).toEqual({
      status: 'closed', offers: 13, offersCapped: false, contacts: 13, clientOpen: 1, clientInProgress: 0
    })
  })
  it('reads a completed project with three other projects in progress', () => {
    expect(snapshotOf(read('mostaql-completed.html'), 'mostaql')).toEqual({
      status: 'completed', offers: 4, offersCapped: false, contacts: 24, clientOpen: 0, clientInProgress: 3
    })
  })
  it('never reads the planted description paragraph or its numbers', () => {
    const html = read('mostaql-open-sure.html')
    const start = html.indexOf('<table class="table table-meta mrg--tt">')
    const end = html.indexOf('</table>', start) + '</table>'.length
    const withoutTable = html.slice(0, start) + html.slice(end)
    expect(withoutTable).toContain('التواصلات الجارية 99')
    expect(withoutTable).not.toContain('table-meta')
    expect(snapshotOf(withoutTable, 'mostaql')).toEqual({
      status: 'open', offers: 7, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('reports a missing status row as null and an unrecognized label class as unknown', () => {
    expect(snapshotOf(metaPanel(metaRow('تاريخ النشر', 'منذ يوم')), 'mostaql')).toEqual(emptySnapshot)
    const unknown = metaPanel(metaRow('حالة المشروع', '<bdi class="label label-prj-foo">غريب</bdi>'))
    expect(snapshotOf(unknown, 'mostaql').status).toBe('unknown')
  })
  it('counts distinct bids, keeps an empty panel at zero and a missing panel at null', () => {
    const html = read('mostaql-open-sure.html')
    const withoutBids = html.slice(0, html.lastIndexOf('<div class="panel panel-default mrg--bn"'))
    expect(withoutBids).not.toContain('bidsCollection-panel')
    expect(snapshotOf(withoutBids, 'mostaql').offers).toBeNull()
    expect(snapshotOf(metaPanel() + bidsPanel(), 'mostaql').offers).toBe(0)
    expect(snapshotOf(metaPanel() + bidsPanel(bid(7), bid(7), bid(8)), 'mostaql').offers).toBe(2)
  })
  it('flags the offers page cap only at exactly 50 distinct bids', () => {
    const atCap = Array.from({ length: WATCH_OFFERS_PAGE_CAP }, (_value, index) => bid(index + 1))
    expect(snapshotOf(metaPanel() + bidsPanel(...atCap), 'mostaql')).toMatchObject({ offers: 50, offersCapped: true })
    expect(snapshotOf(metaPanel() + bidsPanel(...atCap.slice(1)), 'mostaql')).toMatchObject({ offers: 49, offersCapped: false })
  })
  it('never counts attribute-looking text as a bid', () => {
    const html = read('mostaql-open-sure.html')
      .replace('id="bidsCollection-panel">', `id="bidsCollection-panel"><p title=' data-bid-item="123"'>example</p>`)
    expect(html).toContain(`title=' data-bid-item="123"'`)
    expect(snapshotOf(html, 'mostaql')).toEqual({
      status: 'open', offers: 7, offersCapped: false, contacts: 1, clientOpen: 1, clientInProgress: 0
    })
    const prose = metaPanel() + bidsPanel(bid(9000001), '<p>Example: data-bid-item="123"</p>')
    expect(snapshotOf(prose, 'mostaql').offers).toBe(1)
    const commented = metaPanel() + bidsPanel(bid(9000001), '<!--<div data-bid-item="5"></div>-->')
    expect(commented).toContain('data-bid-item="5"')
    expect(snapshotOf(commented, 'mostaql').offers).toBe(1)
  })
  it('reads the status label only from a real class attribute, never from text or a title', () => {
    const titled = metaPanel(metaRow('حالة المشروع', '<bdi title="label-prj-completed">غير معروف</bdi>'))
    expect(snapshotOf(titled, 'mostaql').status).toBeNull()
    const injected = read('mostaql-open-sure.html')
      .replace('<bdi class="label label-prj-open">مفتوح</bdi>', `<bdi title=' class="label-prj-completed"'>other</bdi>`)
    expect(injected).toContain(`title=' class="label-prj-completed"'`)
    expect(injected).not.toContain('label-prj-open')
    expect(snapshotOf(injected, 'mostaql').status).toBeNull()
  })
  it('never borrows a status label from outside the status row', () => {
    const html = '<div id="project-meta-panel"><div class="meta-row">'
      + '<div class="meta-label">حالة المشروع</div></div>'
      + '<div class="label label-prj-completed">مكتمل</div></div>'
    expect(html).toContain('label-prj-completed')
    expect(snapshotOf(html, 'mostaql').status).toBeNull()
  })
  it('maps unknown label suffixes through a Map, never through object prototypes', () => {
    for (const suffix of ['constructor', 'tostring']) {
      const html = metaPanel(metaRow('حالة المشروع', `<bdi class="label label-prj-${suffix}">x</bdi>`))
      const status = snapshotOf(html, 'mostaql').status
      expect(typeof status).toBe('string')
      expect(status).toBe('unknown')
    }
  })
  it('never sees a panel that only exists inside a script body', () => {
    const panel = metaPanel(metaRow('حالة المشروع', '<bdi class="label label-prj-completed">مكتمل</bdi>'))
    const insideX = `<script>var s = "</scriptx>${panel}";</script>`
    expect(insideX).toContain('label-prj-completed')
    expect(parseWatchPage(insideX, 'mostaql')).toEqual({ kind: 'invalid' })
    const insideScript = `<script>var s = "${panel}";</script>`
    expect(parseWatchPage(insideScript, 'mostaql')).toEqual({ kind: 'invalid' })
  })
  it('never treats attribute-looking text as a panel id or a widget', () => {
    expect(parseWatchPage(`<div title='id="project-meta-panel"'>`, 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<div title='data-type="employer_widget"'>`, 'mostaql')).toEqual({ kind: 'invalid' })
  })
  it('refuses a client table that is not inside an employer widget', () => {
    const html = read('mostaql-open-sure.html')
    const marker = html.indexOf('data-type="employer_widget"')
    const openEnd = html.indexOf('>', marker) + 1
    const attack = html.slice(0, openEnd) + '</div>'
      + '<div class="project-description"><table>'
      + '<tr><td>التواصلات الجارية</td><td>99</td></tr>'
      + '<tr><td>المشاريع المفتوحة</td><td>99</td></tr>'
      + '<tr><td>مشاريع قيد التنفيذ</td><td>99</td></tr>'
      + '</table></div>' + html.slice(openEnd)
    expect(attack).toContain('<tr><td>التواصلات الجارية</td><td>99</td></tr>')
    expect(snapshotOf(attack, 'mostaql')).toEqual({
      status: 'open', offers: 7, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('closes an open paragraph at a block element, so its table is not the client table', () => {
    const html = '<p data-type="employer_widget"><div><table>'
      + '<tr><td>التواصلات الجارية</td><td>99</td></tr>'
      + '</table></div>'
    expect(snapshotOf(html, 'mostaql')).toEqual(emptySnapshot)
  })
  it('reads client rows from a table written without closing cells or rows', () => {
    const html = '<div data-type="employer_widget"><table>'
      + '<tr><td>التواصلات الجارية<td>4'
      + '<tr><td>المشاريع المفتوحة<td>1'
      + '<tr><td>مشاريع قيد التنفيذ<td>0'
      + '</table></div>'
    expect(snapshotOf(html, 'mostaql')).toEqual({
      status: null, offers: null, offersCapped: false, contacts: 4, clientOpen: 1, clientInProgress: 0
    })
  })
})

describe('Nafezly watch snapshots', () => {
  it('reads the project card of each status', () => {
    expect(snapshotOf(read('nafezly-open.html'), 'nafezly')).toEqual({
      status: 'open', offers: 88, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
    expect(snapshotOf(read('nafezly-closed.html'), 'nafezly')).toEqual({
      status: 'closed', offers: 136, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
    expect(snapshotOf(read('nafezly-completed.html'), 'nafezly')).toEqual({
      status: 'completed', offers: 21, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('handles a missing status row, unknown status text and Arabic-Indic applicants', () => {
    expect(snapshotOf(nafezlyCard(nafezlyRow('عدد المتقدمين', '5')), 'nafezly')).toEqual({
      status: null, offers: 5, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
    const unknown = nafezlyCard(nafezlyRow('حالة المشروع', '<span class="p-1">قيد المراجعة</span>'))
    expect(snapshotOf(unknown, 'nafezly').status).toBe('unknown')
    const arabicIndic = nafezlyCard(nafezlyRow('حالة المشروع', '<span>مفتوح</span>'), nafezlyRow('عدد المتقدمين', '١٢٣'))
    expect(snapshotOf(arabicIndic, 'nafezly').offers).toBe(123)
  })
  it('reads the status from the label row only, never from the description', () => {
    const html = read('nafezly-open.html')
    expect(html).toContain('حالة المشروع مكتمل — عدد المتقدمين 999')
    expect(snapshotOf(html, 'nafezly')).toEqual({
      status: 'open', offers: 88, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('never invents a card for a heading with nothing after it', () => {
    const html = '<div class="col-12 p-0"><div class="mb-1"> بطاقة المشروع </div></div><p>فاصل</p>'
    expect(parseWatchPage(html, 'nafezly')).toEqual({ kind: 'invalid' })
  })
  it('never reads a card across another element', () => {
    const between = '<div class="col-12 p-0"><div class="mb-1"> بطاقة المشروع </div></div>'
      + '<p>OTHER SECTION</p>'
      + '<div class="col-12 row p-3">' + nafezlyRow('عدد المتقدمين', '999') + '</div>'
    expect(between).toContain('999')
    expect(parseWatchPage(between, 'nafezly')).toEqual({ kind: 'invalid' })
    const inside = '<div class="col-12 p-0"><div class="mb-1"> بطاقة المشروع </div><p>OTHER SECTION</p></div>'
      + '<div class="col-12 row p-3">' + nafezlyRow('عدد المتقدمين', '999') + '</div>'
    expect(inside).toContain('999')
    expect(parseWatchPage(inside, 'nafezly')).toEqual({ kind: 'invalid' })
  })
  it('never flags the offers page cap for Nafezly', () => {
    expect(snapshotOf(nafezlyCard(nafezlyRow('عدد المتقدمين', '50')), 'nafezly'))
      .toEqual({ status: null, offers: 50, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null })
  })
})

describe('KAF watch snapshots', () => {
  it('reads the current stage and offer count of each fixture', () => {
    expect(snapshotOf(read('kaf-open.html'), 'kaf')).toEqual({
      status: 'open', offers: 24, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
    expect(snapshotOf(read('kaf-in-progress.html'), 'kaf')).toEqual({
      status: 'in_progress', offers: 28, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
    expect(snapshotOf(read('kaf-completed.html'), 'kaf')).toEqual({
      status: 'completed', offers: 62, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('still reads offers when the steps container is missing', () => {
    const html = read('kaf-open.html')
    const start = html.indexOf('<div class="block steps-container">')
    const end = html.indexOf('<div class="block collapse-block">')
    const noSteps = html.slice(0, start) + html.slice(end)
    expect(noSteps).not.toContain('steps-container')
    expect(snapshotOf(noSteps, 'kaf')).toEqual({
      status: null, offers: 24, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('never reads the next step title for the current step', () => {
    const html = '<div class="steps-container"><div class="step current"></div>'
      + '<div class="step"><span class="title">مرحلة الإستلام</span></div></div>'
    expect(snapshotOf(html, 'kaf')).toEqual({ ...emptySnapshot, status: 'unknown' })
  })
  it('reads the info table through a block wrapper and through head/body siblings', () => {
    const wrapped = '<div class="block"><div class="block-head"><p class="title">معلومات المشروع</p></div>'
      + '<div class="block-body"><table class="info-table"><tr><td>عدد العروض</td><td>7</td></tr></table></div></div>'
    expect(snapshotOf(wrapped, 'kaf')).toEqual({ ...emptySnapshot, offers: 7 })
    expect(snapshotOf(kafInfo(kafInfoRow('عدد العروض', '9')), 'kaf')).toEqual({ ...emptySnapshot, offers: 9 })
    expect(snapshotOf(kafInfo(kafInfoRow('عدد العروض', '9')), 'kaf', { status: 200 })).toEqual({ ...emptySnapshot, offers: 9 })
  })
  it('never reads an info table from a bare block-head heading', () => {
    const attack = '<div><div class="block-head">معلومات المشروع</div></div>'
      + '<div class="block-body"><table class="info-table"><tr><td>عدد العروض</td><td>999</td></tr></table></div>'
    expect(attack).toContain('999')
    expect(parseWatchPage(attack, 'kaf')).toEqual({ kind: 'invalid' })
    expect(snapshotOf(kafStep('مرحلة تلقي العروض') + attack, 'kaf')).toEqual({
      status: 'open', offers: null, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('never falls through to a later info section', () => {
    const html = kafStep('مرحلة تلقي العروض')
      + '<div class="block-head"><p class="title">معلومات المشروع</p></div><div class="block-body"></div>'
      + '<div class="block-head"><p class="title">معلومات المشروع</p></div>'
      + '<div class="block-body"><table class="info-table"><tr><td>عدد العروض</td><td>999</td></tr></table></div>'
    expect(html).toContain('999')
    expect(snapshotOf(html, 'kaf')).toEqual({
      status: 'open', offers: null, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
  it('never reads an info table that is merely inside the surrounding block', () => {
    const html = kafStep('مرحلة تلقي العروض')
      + '<div class="block"><div class="block-head"><p class="title">معلومات المشروع</p></div>'
      + '<div class="block-body"></div>'
      + '<div class="project-description"><table class="info-table"><tr><td>عدد العروض</td><td>999</td></tr></table></div>'
      + '</div>'
    expect(html).toContain('999')
    expect(snapshotOf(html, 'kaf')).toEqual({
      status: 'open', offers: null, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
    const gap = kafStep('مرحلة تلقي العروض')
      + '<div class="block-head"><p class="title">معلومات المشروع</p></div><p>gap</p>'
      + '<div class="block-body"><table class="info-table"><tr><td>عدد العروض</td><td>999</td></tr></table></div>'
    expect(snapshotOf(gap, 'kaf')).toMatchObject({ offers: null })
  })
  it('never flags the offers page cap for KAF', () => {
    const fixture = read('kaf-open.html').replace(/(<td>\s*)24(\s*<\/td>)/, '$150$2')
    expect(fixture).toContain('50')
    expect(snapshotOf(fixture, 'kaf')).toMatchObject({ offers: 50, offersCapped: false })
    expect(snapshotOf(kafInfo(kafInfoRow('عدد العروض', '50')), 'kaf')).toMatchObject({ offers: 50, offersCapped: false })
  })
  it('ignores an info table that is not inside the project-info section', () => {
    const html = read('kaf-open.html').replace(/<table class="info-table">[\s\S]{0,20000}?<\/table>/, '<table class="info-table"></table>')
    const attack = html + '<div class="project-description"><table class="info-table"><tr><td>عدد العروض</td><td>999</td></tr></table></div>'
    expect(attack).toContain('999')
    expect(snapshotOf(attack, 'kaf')).toMatchObject({ offers: null, status: 'open' })
    const bareHeading = '<p class="title">معلومات المشروع</p><div class="project-description">'
      + '<table class="info-table"><tr><td>عدد العروض</td><td>999</td></tr></table></div>'
    expect(parseWatchPage(bareHeading, 'kaf')).toEqual({ kind: 'invalid' })
  })
})

describe('Inert and foreign content', () => {
  it.each(['template', 'noscript', 'svg', 'math'])('keeps a completed panel inside %s when a div would close an outer p', wrapper => {
    const panel = metaPanel(metaRow('حالة المشروع', '<bdi class="label label-prj-completed">مكتمل</bdi>'))
    expect(parseWatchPage(`<p><${wrapper}>${panel}</${wrapper}></p>`, 'mostaql')).toEqual({ kind: 'invalid' })
  })
  it.each(['template', 'noscript', 'svg', 'math'])('ignores an outer closing div inside %s for listing and private markers', wrapper => {
    const listing = '<title>المشاريع المفتوحة | مستقل</title><form id="filter-projects"></form>'
    expect(parseWatchPage(`<div><${wrapper}></div>${listing}</${wrapper}>`, 'mostaql', {
      status: 200, finalUrl: 'https://mostaql.com/projects'
    })).toEqual({ kind: 'invalid' })
    for (const source of ['kaf', 'nafezly'] as const) {
      const denial = read(`${source}-private-403.html`)
      expect(parseWatchPage(`<div><${wrapper}></div>${denial}</${wrapper}>`, source, { status: 403 }))
        .toEqual({ kind: 'invalid' })
      expect(parseWatchPage(`<div><${wrapper}></div>${denial}`, source, { status: 403 }))
        .toEqual({ kind: 'invalid' })
    }
  })
  it('preserves valid snapshots after inert elements close with open children', () => {
    for (const [file, source] of [
      ['mostaql-open-sure.html', 'mostaql'], ['nafezly-open.html', 'nafezly'], ['kaf-open.html', 'kaf']
    ] as const) {
      const html = read(file)
      const base = snapshotOf(html, source)
      for (const prefix of ['<p><svg><path/></svg></p>', '<div><template><p>x</template></div>', '<template><div></template>']) {
        expect(snapshotOf(prefix + html, source)).toEqual(base)
      }
      expect(parseWatchPage('<p><template></p>' + html, source)).toEqual({ kind: 'invalid' })
    }
  })
  it('reads headings and status labels decorated with eight SVG paths', () => {
    const decoration = `<svg>${'<path/>'.repeat(8)}</svg>`
    const kaf = kafInfo(kafInfoRow('عدد العروض', '5')).replace('معلومات المشروع', decoration + 'معلومات المشروع')
    expect(snapshotOf(kaf, 'kaf')).toEqual({ ...emptySnapshot, offers: 5 })
    const mostaql = metaPanel(metaRow(decoration + 'حالة المشروع', '<bdi class="label-prj-completed">مكتمل</bdi>'))
    expect(snapshotOf(mostaql, 'mostaql')).toEqual({ ...emptySnapshot, status: 'completed' })
  })
  it('never swallows the page after a self-closing svg', () => {
    for (const [file, source] of [
      ['mostaql-open-sure.html', 'mostaql'],
      ['nafezly-open.html', 'nafezly'],
      ['kaf-open.html', 'kaf']
    ] as const) {
      const base = snapshotOf(read(file), source, { status: 200 })
      expect(snapshotOf(`<svg/>${read(file)}`, source, { status: 200 })).toEqual(base)
      expect(snapshotOf(`<svg><svg/></svg>${read(file)}`, source, { status: 200 })).toEqual(base)
      expect(snapshotOf(`<svg><path d="M0 0"/><rect/></svg>${read(file)}`, source, { status: 200 })).toEqual(base)
    }
  })
  it('tokenizes a template through its own comments and quoted attributes', () => {
    const panel = metaPanel(metaRow('حالة المشروع', '<bdi class="label label-prj-completed">مكتمل</bdi>'))
    expect(snapshotOf(`<template><!-- <template> --></template>${panel}`, 'mostaql')).toMatchObject({ status: 'completed' })
    const quoted = `<template><span title="</template>"></span>${panel}</template>`
    expect(quoted).toContain('project-meta-panel')
    expect(parseWatchPage(quoted, 'mostaql')).toEqual({ kind: 'invalid' })
    const listing = '<template><span title="</template>"></span>'
      + '<title>المشاريع المفتوحة | مستقل</title><form id="filter-projects"></form></template>'
    expect(parseWatchPage(listing, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
      .toEqual({ kind: 'invalid' })
  })
  it('never reads a panel, private page or listing inside an inert subtree', () => {
    const panel = metaPanel(metaRow('حالة المشروع', '<bdi class="label label-prj-completed">مكتمل</bdi>'))
    for (const wrapper of ['template', 'noscript', 'svg', 'math']) {
      expect(parseWatchPage(`<${wrapper}>${panel}</${wrapper}>`, 'mostaql')).toEqual({ kind: 'invalid' })
    }
    expect(parseWatchPage(`<svg><g>${panel}</g></svg>`, 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<math><mrow>${panel}</mrow></math>`, 'mostaql')).toEqual({ kind: 'invalid' })
    const kafPrivate = '<template><div class="help-center"><p class="about-desc">'
      + '403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة</p></div></template>'
    expect(parseWatchPage(kafPrivate, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
    const listing = '<template><title>المشاريع المفتوحة | مستقل</title>'
      + '<form id="filter-projects"></form></template>'
    expect(parseWatchPage(listing, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
      .toEqual({ kind: 'invalid' })
  })

  it('rejects closing tags with suffixes on inert wrappers around listing markers', () => {
    const listing = '<title>المشاريع المفتوحة | مستقل</title><form id="filter-projects"></form>'
    for (const wrapper of ['template', 'noscript', 'svg', 'math']) {
      for (const suffix of ['!', '.foo', '=x']) {
        const html = `<${wrapper}></${wrapper}${suffix}>${listing}</${wrapper}>`
        expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
          .toEqual({ kind: 'invalid' })
      }
    }
  })

  it('rejects closing tags with suffixes on inert wrappers around completed panel and private markers', () => {
    const panel = '<div id="project-meta-panel"><div class="meta-row"><div class="meta-label">حالة المشروع</div><div class="meta-value"><bdi class="label label-prj-completed">x</bdi></div></div></div>'
    for (const wrapper of ['template', 'noscript', 'svg', 'math']) {
      for (const suffix of ['!', '.foo', '=x']) {
        expect(parseWatchPage(`<${wrapper}></${wrapper}${suffix}>${panel}</${wrapper}>`, 'mostaql'))
          .toEqual({ kind: 'invalid' })
        for (const source of ['kaf', 'nafezly'] as const) {
          const denial = read(`${source}-private-403.html`)
          expect(parseWatchPage(`<${wrapper}></${wrapper}${suffix}>${denial}</${wrapper}>`, source, { status: 403 }))
            .toEqual({ kind: 'invalid' })
        }
      }
    }
  })

  it('ignores bogus start tags before the completed panel', () => {
    const panel = '<div id="project-meta-panel"><div class="meta-row"><div class="meta-label">حالة المشروع</div><div class="meta-value"><bdi class="label label-prj-completed">x</bdi></div></div></div>'
    expect(snapshotOf(`<template!>${panel}`, 'mostaql')).toMatchObject({ status: 'completed' })
    expect(snapshotOf(`<script.x>${panel}`, 'mostaql')).toMatchObject({ status: 'completed' })
  })

  it('rejects bogus start and end tags containing quoted closing tags inside inert wrappers', () => {
    const listing = '<title>المشاريع المفتوحة | مستقل</title><form id="filter-projects"></form>'
    const panel = '<div id="project-meta-panel"><div class="meta-row"><div class="meta-label">حالة المشروع</div><div class="meta-value"><bdi class="label label-prj-completed">x</bdi></div></div></div>'
    for (const wrapper of ['template', 'noscript', 'svg', 'math']) {
      for (const quotes of ['"', "'"]) {
        for (const tag of [`<a! title=${quotes}></${wrapper}>${quotes}>`, `</a! title=${quotes}></${wrapper}>${quotes}>`]) {
          const listingHtml = `<${wrapper}>${tag}${listing}</${wrapper}>`
          expect(parseWatchPage(listingHtml, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
            .toEqual({ kind: 'invalid' })
          const panelHtml = `<${wrapper}>${tag}${panel}</${wrapper}>`
          expect(parseWatchPage(panelHtml, 'mostaql')).toEqual({ kind: 'invalid' })
        }
      }
    }
  })

  it('closes employer widget when an end tag carries attributes or quoted greater-than', () => {
    const table = '<table><tr><td>التواصلات الجارية</td><td>999</td></tr></table>'
    const repro = `<div data-type="employer_widget"></div data-x="1">${table}`
    const snap1 = snapshotOf(repro, 'mostaql')
    expect(snap1.contacts).toBeNull()
    expect(snap1.clientOpen).toBeNull()
    expect(snap1.clientInProgress).toBeNull()

    const variant = `<div data-type="employer_widget"></div x='>'>${table}`
    const snap2 = snapshotOf(variant, 'mostaql')
    expect(snap2.contacts).toBeNull()
    expect(snap2.clientOpen).toBeNull()
    expect(snap2.clientInProgress).toBeNull()
  })

  it('rejects raw-text and RCDATA closers containing quoted meta panel or listing markers', () => {
    const panel = '<div id="project-meta-panel"><div class="meta-row"><div class="meta-label">حالة المشروع</div><div class="meta-value"><bdi class="label label-prj-completed">x</bdi></div></div></div>'
    const listing = '<title>المشاريع المفتوحة | مستقل</title><form id="filter-projects"></form>'

    expect(parseWatchPage(`<script></script x=">${panel}">`, 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<title></title x=">${panel}">`, 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<textarea></textarea x='>${panel}'>`, 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<style></style x=">${panel}">`, 'mostaql')).toEqual({ kind: 'invalid' })

    expect(parseWatchPage(`<script></script x=">${listing}">`, 'mostaql', {
      status: 200,
      finalUrl: 'https://mostaql.com/projects'
    })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<title></title x=">${listing}">`, 'mostaql', {
      status: 200,
      finalUrl: 'https://mostaql.com/projects'
    })).toEqual({ kind: 'invalid' })
  })

  it('terminates unknown declarations at first greater-than without quote tracking', () => {
    const listing = '<title>المشاريع المفتوحة | مستقل</title><form id="filter-projects"></form>'
    const panel = '<div id="project-meta-panel"><div class="meta-row"><div class="meta-label">حالة المشروع</div><div class="meta-value"><bdi class="label label-prj-completed">x</bdi></div></div></div>'
    for (const wrapper of ['template', 'noscript', 'svg', 'math']) {
      const listingHtml = `<!foo "><${wrapper}>">${listing}</${wrapper}>`
      expect(parseWatchPage(listingHtml, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
        .toEqual({ kind: 'invalid' })
      const panelHtml = `<!foo "><${wrapper}>">${panel}</${wrapper}>`
      expect(parseWatchPage(panelHtml, 'mostaql')).toEqual({ kind: 'invalid' })
    }

    expect(snapshotOf(`<!foo ">${panel}`, 'mostaql')).toMatchObject({ status: 'completed' })
    expect(parseWatchPage(`<!DOCTYPEX "><template>">${listing}</template>`, 'mostaql', {
      status: 200,
      finalUrl: 'https://mostaql.com/projects'
    })).toEqual({ kind: 'invalid' })
    expect(snapshotOf(`<!DOCTYPE html SYSTEM 'x\\'>${panel}`, 'mostaql')).toMatchObject({ status: 'completed' })
  })
})

describe('Counts are never fabricated', () => {
  const padded = (before: number, value: string, after: number): string =>
    ' '.repeat(before) + value + ' '.repeat(after)
  it('rejects a count whose cell hides a second number after whitespace', () => {
    expect(snapshotOf(kafInfo(kafInfoRow('عدد العروض', `5${' '.repeat(5000)}6`)), 'kaf'))
      .toMatchObject({ offers: null })
    expect(snapshotOf(nafezlyCard(nafezlyRow('عدد المتقدمين', `5${' '.repeat(5000)}6`)), 'nafezly'))
      .toMatchObject({ offers: null })
    const widget = (value: string): string => '<div data-type="employer_widget"><table>'
      + `<tr><td>التواصلات الجارية</td><td>${value}</td></tr></table></div>`
    expect(snapshotOf(widget(`5${' '.repeat(5000)}6`), 'mostaql')).toMatchObject({ contacts: null })
  })
  it('still reads a count behind a long whitespace run', () => {
    expect(snapshotOf(kafInfo(kafInfoRow('عدد العروض', padded(5000, '5', 5000))), 'kaf'))
      .toMatchObject({ offers: 5 })
    expect(snapshotOf(nafezlyCard(nafezlyRow('عدد المتقدمين', padded(5000, '5', 0))), 'nafezly'))
      .toMatchObject({ offers: 5 })
    const widget = (value: string): string => '<div data-type="employer_widget"><table>'
      + `<tr><td>التواصلات الجارية</td><td>${value}</td></tr></table></div>`
    expect(snapshotOf(widget(padded(5000, '5', 0)), 'mostaql')).toMatchObject({ contacts: 5 })
  })
})

describe('Truncated text never matches', () => {
  const suffix = ' '.repeat(200_001) + 'OTHER'

  it('reports unknown for a truncated Nafezly status or KAF stage', () => {
    expect(snapshotOf(nafezlyCard(nafezlyRow('حالة المشروع', 'مكتمل' + suffix)), 'nafezly').status).toBe('unknown')
    expect(snapshotOf(kafStep('مرحلة الإستلام' + suffix), 'kaf').status).toBe('unknown')
  })

  it('rejects truncated status and count row labels', () => {
    expect(snapshotOf(metaPanel(metaRow('حالة المشروع' + suffix, '<bdi class="label-prj-completed">مكتمل</bdi>')), 'mostaql').status)
      .toBeNull()
    expect(snapshotOf(nafezlyCard(nafezlyRow('حالة المشروع' + suffix, 'مكتمل')), 'nafezly').status).toBeNull()
    expect(snapshotOf(nafezlyCard(nafezlyRow('عدد المتقدمين' + suffix, '5')), 'nafezly').offers).toBeNull()
    expect(snapshotOf(kafInfo(kafInfoRow('عدد العروض' + suffix, '5')), 'kaf').offers).toBeNull()
    const widget = '<div data-type="employer_widget"><table>'
      + `<tr><td>التواصلات الجارية${suffix}</td><td>5</td></tr></table></div>`
    expect(snapshotOf(widget, 'mostaql').contacts).toBeNull()
  })

  it('rejects truncated project headings', () => {
    expect(parseWatchPage(nafezlyCard(nafezlyRow('عدد المتقدمين', '5'))
      .replace('بطاقة المشروع', 'بطاقة المشروع' + suffix), 'nafezly')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(kafInfo(kafInfoRow('عدد العروض', '5'))
      .replace('معلومات المشروع', 'معلومات المشروع' + suffix), 'kaf')).toEqual({ kind: 'invalid' })
  })

  it('rejects truncated private titles, h3 messages and about-desc messages', () => {
    const title = '<title>خطأ 403 | نفذلي</title>'
    const message = '403 | غير مصرح لك بتنفيذ هذه العملية'
    expect(parseWatchPage(`${title}<h3>${message}${suffix}</h3>`, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(`<title>خطأ 403 | نفذلي${suffix}</title><h3>${message}</h3>`, 'nafezly', { status: 403 }))
      .toEqual({ kind: 'invalid' })
    const kaf = '<div class="help-center"><p class="about-desc">'
      + `403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة${suffix}</p></div>`
    expect(parseWatchPage(kaf, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
  })

  it('rejects a truncated listing title prefix', () => {
    const html = `<title>المشاريع المفتوحة | مستقل${suffix}</title><form id="filter-projects"></form>`
    expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
      .toEqual({ kind: 'invalid' })
  })
})

describe('Watch page classification', () => {
  it('treats 404 and 410 as gone', () => {
    expect(parseWatchPage(read('kaf-open.html'), 'kaf', { status: 404 })).toEqual({ kind: 'gone' })
    expect(parseWatchPage(read('mostaql-open-sure.html'), 'mostaql', { status: 410 })).toEqual({ kind: 'gone' })
  })
  it('classifies a removed project before looking at the body', () => {
    expect(parseWatchPage('', 'mostaql', { status: 404 })).toEqual({ kind: 'gone' })
    expect(parseWatchPage('   \n\t ', 'kaf', { status: 410 })).toEqual({ kind: 'gone' })
    expect(parseWatchPage('<html>not a page</html>', 'nafezly', { status: 404 })).toEqual({ kind: 'gone' })
  })
  it('detects a challenge before the size and nesting limits', () => {
    const nested = '<title>Just a moment...</title>' + '<div>'.repeat(513)
    expect(parseWatchPage(nested, 'mostaql')).toEqual({ kind: 'challenge' })
    const huge = '<title>Just a moment...</title>' + 'x'.repeat(3_000_001)
    expect(parseWatchPage(huge, 'mostaql')).toEqual({ kind: 'challenge' })
    expect(parseWatchPage('x'.repeat(3_000_000) + 'cf-chl-', 'mostaql')).toEqual({ kind: 'invalid' })
  })
  it('treats a redirect to the Mostaql projects listing as gone', () => {
    const html = read('mostaql-gone-redirect.html')
    expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' })).toEqual({ kind: 'gone' })
    expect(parseWatchPage(html, 'mostaql', { finalUrl: 'https://mostaql.com/projects/' })).toEqual({ kind: 'gone' })
  })
  it('never infers gone from page text alone', () => {
    const html = read('mostaql-gone-redirect.html')
    expect(parseWatchPage(html, 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/project/1-example' })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'https://evil.example/projects' })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'http://mostaql.com/projects' })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(html, 'mostaql', { status: 503, finalUrl: 'https://mostaql.com/projects' })).toEqual({ kind: 'invalid' })
    const maintenance = '<nav>المشاريع المفتوحة</nav><h1>Maintenance</h1>'
    expect(parseWatchPage(maintenance, 'mostaql', { status: 503 })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(maintenance, 'mostaql', { status: 200 })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(maintenance, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' })).toEqual({ kind: 'invalid' })
  })
  it('never sees a listing that only exists as a nav heading or a script body', () => {
    const listing = read('mostaql-gone-redirect.html')
    const noFilter = listing.replace('<form id="filter-projects">', '<form id="filter-project">')
    expect(noFilter).not.toContain('filter-projects')
    expect(parseWatchPage(noFilter, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' })).toEqual({ kind: 'invalid' })
    const noTitle = listing.replace('المشاريع المفتوحة | مستقل', 'مستقل')
    expect(parseWatchPage(noTitle, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' })).toEqual({ kind: 'invalid' })
    const commented = '<html><head><title>المشاريع المفتوحة | مستقل</title></head><body>'
      + `<!-- <form id="filter-projects"></form> --></body></html>`
    expect(parseWatchPage(commented, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' })).toEqual({ kind: 'invalid' })
  })
  it('detects the protection challenge before any private message', () => {
    const challenged = '<html><head><title>Just a moment...</title></head><body><p>غير مصرح لك بتنفيذ هذه العملية</p></body></html>'
    expect(parseWatchPage(challenged, 'nafezly', { status: 403 })).toEqual({ kind: 'challenge' })
    const widget = '<html><body><div class="cf-chl-widget"></div><p>غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة</p></body></html>'
    expect(parseWatchPage(widget, 'kaf', { status: 403 })).toEqual({ kind: 'challenge' })
  })
  it('reports the real private pages as private only on HTTP 403', () => {
    const kaf = read('kaf-private-403.html'), nafezly = read('nafezly-private-403.html')
    expect(parseWatchPage(kaf, 'kaf', { status: 403 })).toEqual({ kind: 'private' })
    expect(parseWatchPage(nafezly, 'nafezly', { status: 403 })).toEqual({ kind: 'private' })
    for (const status of [200, 429, undefined]) {
      expect(parseWatchPage(kaf, 'kaf', status === undefined ? undefined : { status })).toEqual({ kind: 'invalid' })
      expect(parseWatchPage(nafezly, 'nafezly', status === undefined ? undefined : { status })).toEqual({ kind: 'invalid' })
    }
  })
  it('requires the source-specific private page structure', () => {
    const kaf = read('kaf-private-403.html'), nafezly = read('nafezly-private-403.html')
    expect(parseWatchPage(kaf, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
    expect(parseWatchPage(nafezly, 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
    const generic = '<h1>Access denied</h1><p>غير مصرح لك بتنفيذ هذه العملية</p>'
    expect(parseWatchPage(generic, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
    for (const source of WATCH_SOURCES) expect(parseWatchPage(generic, source, { status: 403 })).toEqual({ kind: 'invalid' })
    const titleOnly = '<html><head><title>خطأ 403 | نفذلي</title></head><body><h3>غير مصرح</h3></body></html>'
    expect(parseWatchPage(titleOnly, 'nafezly', { status: 403 })).toEqual({ kind: 'invalid' })
    const textOnly = '<html><body><div class="help-center"><p class="about-desc">403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة</p></div></body></html>'
    expect(parseWatchPage(textOnly, 'kaf', { status: 403 })).toEqual({ kind: 'private' })
    expect(parseWatchPage(textOnly.replace('class="about-desc"', 'title="about-desc"'), 'kaf', { status: 403 })).toEqual({ kind: 'invalid' })
  })
  it('rejects empty, whitespace-only and unrelated pages', () => {
    expect(parseWatchPage('', 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage('', 'kaf')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage('   \n\t ', 'nafezly')).toEqual({ kind: 'invalid' })
    const random = '<html><body><div class="card">مرحبا</div></body></html>'
    for (const source of WATCH_SOURCES) expect(parseWatchPage(random, source)).toEqual({ kind: 'invalid' })
    expect(parseWatchPage('<h1>Maintenance</h1>', 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
      .toEqual({ kind: 'invalid' })
  })
  it('keeps a project page a snapshot when its description quotes the private phrase', () => {
    const mostaql = read('mostaql-open-sure.html').replace('وصف تجريبي.', 'وصف تجريبي. غير مصرح لك.')
    expect(mostaql).toContain('غير مصرح لك')
    expect(snapshotOf(mostaql, 'mostaql', { status: 403 })).toEqual({
      status: 'open', offers: 7, offersCapped: false, contacts: 1, clientOpen: 1, clientInProgress: 0
    })
    const nafezly = read('nafezly-open.html').replace('وصف تجريبي.', 'وصف تجريبي. غير مصرح لك.')
    expect(nafezly).toContain('غير مصرح لك')
    expect(snapshotOf(nafezly, 'nafezly', { status: 403 })).toEqual({
      status: 'open', offers: 88, offersCapped: false, contacts: null, clientOpen: null, clientInProgress: null
    })
  })
})

describe('Watch markers on large pages', () => {
  const prependBody = (html: string, prefix: string): string => {
    expect(html).toContain('<body>')
    return html.replace('<body>', '<body>' + prefix)
  }

  it.each(['nafezly-open.html', 'nafezly-closed.html', 'nafezly-completed.html'])('finds %s after thousands of unrelated divs and headings', file => {
    const html = read(file)
    const prefix = '<div><span>x</span></div>'.repeat(5000) + '<h3>y</h3>'.repeat(500)
    expect(snapshotOf(prependBody(html, prefix), 'nafezly')).toEqual(snapshotOf(html, 'nafezly'))
  })

  it('tries every matching Nafezly heading until one owns a card', () => {
    const html = read('nafezly-open.html')
    const padded = prependBody(html, '<div>بطاقة المشروع</div><p>other section</p>'.repeat(5000))
    const started = performance.now()
    const actual = snapshotOf(padded, 'nafezly')
    expect(performance.now() - started).toBeLessThan(1000)
    expect(actual).toEqual(snapshotOf(html, 'nafezly'))
  })

  it('finds the KAF info heading after 5000 unrelated sections within one second', () => {
    const html = read('kaf-open.html')
    const prefix = '<div class="block-head"><p class="title">قسم آخر</p></div><div class="block-body"></div>'
    const padded = prependBody(html, prefix.repeat(5000))
    const started = performance.now()
    const actual = snapshotOf(padded, 'kaf')
    expect(performance.now() - started).toBeLessThan(1000)
    expect(actual).toEqual(snapshotOf(html, 'kaf'))
  })

  it.each(['nafezly', 'kaf'] as const)('finds the %s denial after 5000 unrelated denial candidates', source => {
    const prefix = source === 'nafezly' ? '<h3>x</h3>'.repeat(5000)
      : '<div class="help-center">' + '<p class="about-desc">x</p>'.repeat(5000) + '</div>'
    const html = prependBody(read(`${source}-private-403.html`), prefix)
    expect(parseWatchPage(html, source, { status: 403 })).toEqual({ kind: 'private' })
  })

  it('finds the Mostaql listing after 5000 small divs', () => {
    const html = prependBody(read('mostaql-gone-redirect.html'), '<div><span>x</span></div>'.repeat(5000))
    expect(parseWatchPage(html, 'mostaql', { status: 200, finalUrl: 'https://mostaql.com/projects' }))
      .toEqual({ kind: 'gone' })
  })

  it('searches past unrelated and oversized title elements for the actual marker', () => {
    const prefix = '<title>Other</title>'.repeat(5000) + `<title>${'&amp;'.repeat(400_000)}</title>`
    // Incomplete visible-text inspection (400k entities) must never yield 'private'.
    expect(parseWatchPage(prefix + read('nafezly-private-403.html'), 'nafezly', { status: 403 }))
      .toEqual({ kind: 'invalid' })
    expect(parseWatchPage(prefix + read('mostaql-gone-redirect.html'), 'mostaql', {
      status: 200, finalUrl: 'https://mostaql.com/projects'
    })).toEqual({ kind: 'gone' })
  })

  it('bounds total raw marker text across nodes while ignoring inert text', () => {
    const html = nafezlyCard(nafezlyRow('عدد المتقدمين', '5'))
    const label = ' بطاقة المشروع '
    const atLimit = html.replace(label, label + ' '.repeat(256 - label.length))
    expect(snapshotOf(atLimit, 'nafezly').offers).toBe(5)
    const beyond = html.replace(label, label + `<span>${' '.repeat(128)}</span><span>${' '.repeat(128)}</span>`)
    expect(parseWatchPage(beyond, 'nafezly')).toEqual({ kind: 'invalid' })
    const decorated = html.replace(label, label + `<template>${'x'.repeat(1000)}</template>`)
    expect(snapshotOf(decorated, 'nafezly').offers).toBe(5)
  })
})

describe('Watch parser stays linear on malformed input', () => {
  it.each(['nafezly', 'kaf'] as const)('bounds entity decoding in 100 nested %s denial candidates', source => {
    const prefix = source === 'nafezly' ? '<title>خطأ 403 | نفذلي</title>' : '<div class="help-center">'
    const opening = source === 'nafezly' ? '<h3>' : '<p class="about-desc">'
    const closing = source === 'nafezly' ? '</h3>' : '</p>'
    const html = prefix + opening.repeat(100) + '&amp;'.repeat(400_000) + closing.repeat(100)
      + (source === 'kaf' ? '</div>' : '')
    const started = performance.now()
    expect(parseWatchPage(html, source, { status: 403 })).toEqual({ kind: 'invalid' })
    expect(performance.now() - started).toBeLessThan(1000)
    // The oversized candidates exhaust the visible-text budget, so even a real marker after them must not yield 'private'.
    const marker = source === 'nafezly'
      ? '<h3>403 | غير مصرح لك بتنفيذ هذه العملية</h3>'
      : '<div class="help-center"><p class="about-desc">403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة</p></div>'
    expect(parseWatchPage(html + marker, source, { status: 403 })).toEqual({ kind: 'invalid' })
  })
  it.each(['nafezly', 'kaf'] as const)('finds %s denials on either side of the former 50-candidate cap', source => {
    const title = source === 'nafezly' ? '<title>خطأ 403 | نفذلي</title>' : ''
    const message = source === 'nafezly'
      ? '403 | غير مصرح لك بتنفيذ هذه العملية'
      : '403 | غير مصرح لك بإتخاذ هذا الإجراء أو الدخول إلى هذه الصفحة'
    const candidate = (body: string): string => source === 'nafezly'
      ? `<h3>${body}</h3>`
      : `<div class="help-center"><p class="about-desc">${body}</p></div>`
    expect(parseWatchPage(title + candidate('no').repeat(49) + candidate(message), source, { status: 403 }))
      .toEqual({ kind: 'private' })
    expect(parseWatchPage(title + candidate('no').repeat(50) + candidate(message), source, { status: 403 }))
      .toEqual({ kind: 'private' })
  })
  const elapsed = (html: string): number => {
    const started = performance.now()
    for (const source of WATCH_SOURCES) parseWatchPage(html, source)
    return performance.now() - started
  }
  it('returns quickly for pathological markup', () => {
    expect(elapsed('<div '.repeat(250_000))).toBeLessThan(5000)
    expect(elapsed('<script>'.repeat(150_000))).toBeLessThan(5000)
    expect(elapsed('<!--'.repeat(300_000))).toBeLessThan(5000)
    expect(elapsed(`<div class="steps-container">${'<div class="step current">'.repeat(100_000)}`)).toBeLessThan(5000)
    expect(elapsed(read('mostaql-open-sure.html') + 'x'.repeat(1_000_000))).toBeLessThan(5000)
    expect(elapsed('<div class="'.repeat(200_000))).toBeLessThan(5000)
    expect(elapsed('<div data-type="employer_widget"><table>' + '<tr><td>'.repeat(200_000))).toBeLessThan(5000)
    expect(elapsed('<div>'.repeat(300_000))).toBeLessThan(5000)
    expect(elapsed('<a b='.repeat(300_000))).toBeLessThan(5000)
  })
  it('returns quickly with hundreds of thousands of siblings after a heading', () => {
    const nafezly = (count: number): string => `<div>بطاقة المشروع</div>${'<p></p>'.repeat(count)}`
    const kaf = (count: number): string =>
      `<div class="block-head"><p class="title">معلومات المشروع</p></div>${'<p></p>'.repeat(count)}`
    expect(elapsed(nafezly(100_000))).toBeLessThan(5000)
    expect(elapsed(nafezly(300_000))).toBeLessThan(5000)
    expect(elapsed(kaf(100_000))).toBeLessThan(5000)
    expect(elapsed(kaf(300_000))).toBeLessThan(5000)
  })
  it('guards linearity independent of machine speed on heading followed by small siblings', () => {
    const nafezly = (count: number): string => `<div>بطاقة المشروع</div>${'<p></p>'.repeat(count)}`
    const measure = (count: number): { minTime: number; lastResult: ReturnType<typeof parseWatchPage> } => {
      const html = nafezly(count)
      // warm-up call
      parseWatchPage(html, 'nafezly')
      let minTime = Infinity
      let lastResult: ReturnType<typeof parseWatchPage> = { kind: 'invalid' }
      for (let run = 0; run < 5; run++) {
        const start = performance.now()
        lastResult = parseWatchPage(html, 'nafezly')
        const dur = performance.now() - start
        if (dur < minTime) minTime = dur
      }
      return { minTime, lastResult }
    }

    const res50k = measure(50_000)
    const res100k = measure(100_000)
    const res200k = measure(200_000)

    console.log(`[SCALING] 50k: ${res50k.minTime.toFixed(2)}ms, 100k: ${res100k.minTime.toFixed(2)}ms, 200k: ${res200k.minTime.toFixed(2)}ms`)

    // Correctness assertions stay separate from timing assertions
    expect(res50k.lastResult).toEqual({ kind: 'invalid' })
    expect(res100k.lastResult).toEqual({ kind: 'invalid' })
    expect(res200k.lastResult).toEqual({ kind: 'invalid' })

    // Linearity assertion: time(200k) < 8 * time(50k) + 100 ms
    expect(res200k.minTime).toBeLessThan(8 * res50k.minTime + 100)
  })
  it('returns quickly when every candidate has a huge subtree', () => {
    const nested = '<div>'.repeat(500) + '<i></i>'.repeat(150_000) + '</div>'.repeat(500)
    expect(nested.length).toBeGreaterThan(1_000_000)
    expect(elapsed(nested)).toBeLessThan(5000)
    expect(elapsed('<div>'.repeat(500) + '<p></p>'.repeat(150_000))).toBeLessThan(5000)
    const table = '<div data-type="employer_widget"><table>'
      + '<tr><td>x</td><td>1</td></tr>'.repeat(60_000) + '</table></div>'
    expect(table.length).toBeGreaterThan(1_000_000)
    expect(elapsed(table)).toBeLessThan(5000)
  })
  it('rejects tags that never end within the tag budget', () => {
    expect(parseWatchPage('</div ' + 'a'.repeat(100_000), 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage('<div a="' + 'x'.repeat(100_000), 'mostaql')).toEqual({ kind: 'invalid' })
  })
  it('returns quickly when a step title is a million angle brackets', () => {
    const html = `<div class="steps-container"><div class="step current"><span class="title">${'<'.repeat(1_000_000)}</span></div></div>`
    const started = performance.now()
    const page = parseWatchPage(html, 'kaf')
    const took = performance.now() - started
    expect(took).toBeLessThan(5000)
    expect(page).toEqual({ kind: 'snapshot', snapshot: { ...emptySnapshot, status: 'unknown' } })
  })
  it('rejects oversized input outright', () => {
    expect(parseWatchPage('x'.repeat(3_000_001), 'mostaql')).toEqual({ kind: 'invalid' })
    expect(parseWatchPage('x'.repeat(3_000_001), 'kaf')).toEqual({ kind: 'invalid' })
  })
})

describe('Watch contact attribution', () => {
  const sure: WatchSnapshot = {
    status: 'open', offers: 3, offersCapped: false, contacts: 1, clientOpen: 1, clientInProgress: 0
  }
  it('is sure only for an open project whose client is idle elsewhere', () => {
    expect(contactAttribution(sure)).toBe('sure')
    expect(contactAttribution({ ...sure, status: 'in_progress' })).toBe('maybe')
    expect(contactAttribution({ ...sure, status: null })).toBe('maybe')
    expect(contactAttribution({ ...sure, clientOpen: 2 })).toBe('maybe')
    expect(contactAttribution({ ...sure, clientOpen: 0 })).toBe('maybe')
    expect(contactAttribution({ ...sure, clientOpen: null })).toBe('maybe')
    expect(contactAttribution({ ...sure, clientInProgress: 1 })).toBe('maybe')
    expect(contactAttribution({ ...sure, clientInProgress: null })).toBe('maybe')
  })
  it('marks fixture projects accordingly', () => {
    expect(contactAttribution(snapshotOf(read('mostaql-open-sure.html'), 'mostaql'))).toBe('sure')
    expect(contactAttribution(snapshotOf(read('mostaql-open-contacts.html'), 'mostaql'))).toBe('sure')
    expect(contactAttribution(snapshotOf(read('mostaql-processing.html'), 'mostaql'))).toBe('maybe')
    expect(contactAttribution(snapshotOf(read('mostaql-closed.html'), 'mostaql'))).toBe('maybe')
    expect(contactAttribution(snapshotOf(read('mostaql-completed.html'), 'mostaql'))).toBe('maybe')
  })
})

describe('Project facts keep their previous behavior', () => {
  it('reads the same Mostaql and Nafezly card fields', () => {
    expect(parseProjectFacts(readFileSync('tests/fixtures/mostaql-facts.html', 'utf8'), 'mostaql'))
      .toMatchObject({ budgetMin: 25, budgetMax: 50, durationDays: 5, currency: 'USD' })
    expect(parseProjectFacts(readFileSync('tests/fixtures/nafezly-facts.html', 'utf8'), 'nafezly'))
      .toMatchObject({ budgetMin: 10, budgetMax: 25, durationDays: 1 })
    expect(parseProjectFacts('<p>ميزانية 500 دولار</p>', 'nafezly')).toBeNull()
  })
})
