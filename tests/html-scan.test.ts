import { describe, expect, it } from 'vitest'
import {
  MAX_ATTRS,
  MAX_DEPTH,
  MAX_INPUT_CHARS,
  MAX_NODES,
  MAX_TAG_CHARS,
  TEXT_RAW_BUDGET,
  attribute,
  childElements,
  closest,
  descendants,
  find,
  findAll,
  hasClass,
  nextElementSibling,
  readText,
  scanHtml,
  text,
  type ElementNode
} from '../src/collector/htmlScan.js'

function parse(html: string): ElementNode {
  const result = scanHtml(html)
  if (!result.ok) throw new Error(`unexpected scan failure: ${result.reason}`)
  return result.root
}

function element(root: ElementNode, name: string): ElementNode {
  const found = find(root, node => node.name === name)
  if (found === null) throw new Error(`missing <${name}>`)
  return found
}

describe('htmlScan tokenizer', () => {
  it('never re-tokenizes text inside a quoted attribute value', () => {
    const root = parse(`<p title=' data-bid-item="123"' class="a b">text</p>`)
    const p = element(root, 'p')
    expect([...p.attrs.keys()]).toEqual(['title', 'class'])
    expect(attribute(p, 'title')).toBe(' data-bid-item="123"')
    expect(hasClass(p, 'a')).toBe(true)
    expect(hasClass(p, 'b')).toBe(true)
    expect(text(p)).toBe('text')
  })

  it('accepts angle brackets inside quoted values', () => {
    const root = parse('<div title="a<b>c" data-x=\'</div>\'><span>x</span></div>')
    const div = element(root, 'div')
    expect(attribute(div, 'title')).toBe('a<b>c')
    expect(attribute(div, 'data-x')).toBe('</div>')
    expect(element(root, 'span').parent).toBe(div)
  })

  it('reads unquoted attribute values and lowercase names', () => {
    const root = parse('<DIV DATA-Type=employer_widget CLASS=x>y</DIV>')
    const div = element(root, 'div')
    expect(attribute(div, 'data-type')).toBe('employer_widget')
    expect(hasClass(div, 'x')).toBe(true)
    expect(div.attrs.has('DATA-Type')).toBe(false)
  })

  it('keeps the first occurrence of a duplicated attribute', () => {
    const root = parse('<div class="a" class="b"></div>')
    expect(hasClass(element(root, 'div'), 'a')).toBe(true)
    expect(hasClass(element(root, 'div'), 'b')).toBe(false)
  })

  it('treats a < that cannot start a tag as text', () => {
    const root = parse('<p>a < b > c <3 x</p>')
    expect(text(root)).toBe('a < b > c <3 x')
    expect(childElements(element(root, 'p'))).toHaveLength(0)
  })

  it('skips comments, cdata, doctypes and processing instructions', () => {
    const root = parse('<!doctype html><?xml version="1.0"?><div><!-- <p>hidden</p> -->'
      + '<![CDATA[ <p>also hidden</p> ]]><span>shown</span></div>')
    expect(find(root, node => node.name === 'p')).toBeNull()
    expect(text(root)).toBe('shown')
    expect(childElements(root).map(node => node.name)).toEqual(['div'])
  })

  it('drops raw script and style bodies until the real closing tag', () => {
    const root = parse('<div><script>var a = "<p>x</p>";</script><style>.a{content:"<b>"}</style><span>after</span></div>')
    expect(find(root, node => node.name === 'p' || node.name === 'b')).toBeNull()
    expect(text(root)).toBe('after')
  })

  it('drops the body of every other raw-text element', () => {
    const root = parse('<xmp><div>x</div></xmp><iframe><p></p></iframe><noembed><b></b></noembed>'
      + '<noframes><i></i></noframes><div>after</div>')
    expect(childElements(root).map(node => node.name)).toEqual(['xmp', 'iframe', 'noembed', 'noframes', 'div'])
    expect(find(root, node => node.name === 'b' || node.name === 'i')).toBeNull()
    expect(find(root, node => node.name === 'p')).toBeNull()
    expect(text(root)).toBe('after')
  })

  it('lets plaintext consume the rest of the document', () => {
    const root = parse('<div>before<plaintext><p>hidden</p></div>')
    expect(find(root, node => node.name === 'p')).toBeNull()
    expect(text(root)).toBe('before')
  })

  it('does not let </scriptx> end a script body', () => {
    const root = parse('<script>var s = "</scriptx><div class="hidden">";</script><p>after</p>')
    expect(find(root, node => node.name === 'div')).toBeNull()
    expect(find(root, node => node.name === 'script')).not.toBeNull()
    expect(text(root)).toBe('after')
  })

  it('closes raw text on </script followed by whitespace, slash or >', () => {
    const root = parse('<script>a</script ><p>one</p><script>b</scriptx></script><p>two</p>')
    expect(findAll(root, node => node.name === 'p').map(node => text(node))).toEqual(['one', 'two'])
  })

  it('keeps title and textarea content as text, never as markup', () => {
    const root = parse('<title><div id="t">tt</div></title><textarea><div id="a"></div></textarea><p>x</p>')
    expect(find(root, node => node.name === 'div')).toBeNull()
    expect(text(element(root, 'title'))).toContain('tt')
    expect(childElements(element(root, 'title'))).toHaveLength(0)
    expect(childElements(element(root, 'textarea'))).toHaveLength(0)
  })

  it('tokenizes inert subtrees but never exposes them to queries', () => {
    const root = parse('<template><div class="x">inside</div><template><p>deep</p></template></template><p>after</p>')
    expect(find(root, node => hasClass(node, 'x'))).toBeNull()
    expect(findAll(root, node => node.name === 'p').map(node => text(node))).toEqual(['after'])
    expect(text(root)).toBe('after')
    // The element is in the tree, parsed normally, but inert.
    const template = root.children.find(child => child.type === 'element' && child.name === 'template')
    expect(template !== undefined && template.type === 'element' && template.inert).toBe(true)
    expect(childElements(root).map(node => node.name)).toEqual(['p'])
    const svg = parse('<svg><div id="panel"></div><svg><div id="inner"></div></svg></svg><div id="real"></div>')
    expect(find(svg, node => attribute(node, 'id') === 'panel')).toBeNull()
    expect(find(svg, node => attribute(node, 'id') === 'inner')).toBeNull()
    expect(find(svg, node => attribute(node, 'id') === 'real')).not.toBeNull()
    const math = parse('<math><div id="m"></div></math><p>ok</p>')
    expect(find(math, node => attribute(node, 'id') === 'm')).toBeNull()
    expect(text(math)).toBe('ok')
  })

  it('lets the same tokenizer handle quotes and comments inside inert subtrees', () => {
    // A comment that only looks like an opening tag must not shift the depth.
    const commented = parse('<template><!-- <template> --></template><div id="panel"></div>')
    expect(find(commented, node => attribute(node, 'id') === 'panel')).not.toBeNull()
    // A quoted closing tag inside an attribute does not end the template.
    const quoted = parse('<template><span title="</template>"></span><div id="hidden"></div></template>')
    expect(find(quoted, node => attribute(node, 'id') === 'hidden')).toBeNull()
    expect(quoted.children.some(child => child.type === 'element' && child.name === 'div')).toBe(false)
  })

  it.each(['template', 'noscript', 'svg', 'math'])('keeps implied end tags inside the %s boundary', wrapper => {
    for (const [outer, incoming] of [['p', 'div'], ['li', 'li'], ['tr', 'tr'], ['td', 'th'], ['th', 'td'], ['option', 'option']]) {
      const root = parse(`<${outer}><${wrapper}><${incoming}>hidden</${incoming}></${wrapper}></${outer}><b>after</b>`)
      expect(text(root)).toBe('after')
      const outerNode = element(root, outer!)
      const boundary = outerNode.children[0]!
      expect(boundary.type).toBe('element')
      if (boundary.type !== 'element') throw new Error('missing inert boundary')
      expect(boundary.name).toBe(wrapper)
      expect(boundary.inert).toBe(true)
      const inside = boundary.children[0]!
      expect(inside.type === 'element' && inside.inert && inside.parent === boundary).toBe(true)
    }
  })

  it.each(['template', 'noscript', 'svg', 'math'])('ignores outer end tags across the %s boundary', wrapper => {
    expect(text(parse(`<div><${wrapper}></div><b>hidden</b></${wrapper}></div><b>after</b>`))).toBe('after')
    // Without the inert element's own end tag, even the trailing content stays inert.
    expect(text(parse(`<div><${wrapper}></div><b>hidden</b>`))).toBe('')
  })

  it('only closes the innermost inert boundary by its own name', () => {
    const root = parse('<template><svg></template><b>hidden</b></svg><b>still hidden</b></template><b>after</b>')
    expect(text(root)).toBe('after')
    for (const prefix of ['<p><svg><path/></svg></p>', '<div><template><p>x</template></div>', '<template><div></template>']) {
      expect(text(parse(`${prefix}<b>after</b>`))).toBe('after')
    }
    expect(text(parse('<template><div>x</div><b>hidden</b></template><b>after</b>'))).toBe('after')
  })

  it('honours self-closing syntax only in foreign content', () => {
    const empty = parse('<svg/><p>after</p>')
    expect(empty.children.some(child => child.type === 'element' && child.name === 'svg')).toBe(true)
    expect(find(empty, node => node.name === 'p')).not.toBeNull()
    expect(text(empty)).toBe('after')
    const nested = parse('<svg><svg/></svg><p>after</p>')
    expect(find(nested, node => node.name === 'p')).not.toBeNull()
    expect(text(nested)).toBe('after')
    const paths = parse('<svg><path d="x"/><circle/></svg><div id="real"></div>')
    expect(find(paths, node => attribute(node, 'id') === 'real')).not.toBeNull()
    // Outside foreign content the slash is still ignored: the element opens.
    const html = parse('<span/><b>x</b></span>')
    expect(element(html, 'b').parent!.name).toBe('span')
  })

  it('skips a CDATA section inside foreign content', () => {
    const root = parse('<svg><![CDATA[ <circle r="9"/> ]]><rect/></svg><p>ok</p>')
    expect(find(root, node => node.name === 'circle')).toBeNull()
    expect(text(root)).toBe('ok')
    const math = parse('<math><![CDATA[ x ]]><mrow/></math><p>ok</p>')
    expect(text(math)).toBe('ok')
  })

  it('never nests children inside void elements', () => {
    const root = parse('<div><br><img src="x"><input><hr><p>x</p></div>')
    expect(childElements(element(root, 'div')).map(node => node.name)).toEqual(['br', 'img', 'input', 'hr', 'p'])
    expect(childElements(element(root, 'br'))).toHaveLength(0)
  })

  it('ignores a self-closing slash on a non-void element', () => {
    const root = parse('<div/><span>x</span></div>')
    const div = element(root, 'div')
    expect(element(root, 'span').parent).toBe(div)
    const script = parse('<script/>var a = "<div id=\'x\'></div>";</script><p>after</p>')
    expect(find(script, node => attribute(node, 'id') === 'x')).toBeNull()
    expect(text(script)).toBe('after')
  })

  it('ignores a closing tag that has no open match', () => {
    const root = parse('<div><span>a</div></b><p>x</p>')
    expect(element(root, 'p').parent).toBe(root)
    expect(element(root, 'div').parent).toBe(root)
  })

  it('does not close an element when an end tag has an invalid name', () => {
    const root = parse('<div id="a"><p>x</p></div!><span id="b"></span></div>')
    const div = element(root, 'div')
    const span = element(root, 'span')
    expect(attribute(div, 'id')).toBe('a')
    expect(attribute(span, 'id')).toBe('b')
    expect(span.parent).toBe(div)
  })

  it('accepts valid start and end tag names', () => {
    const root = parse('<my-tag><svg><svg:rect/></svg><h1>title</h1 ><DIV>content</DIV><div id="c"></div/></my-tag>')
    const myTag = element(root, 'my-tag')
    expect(myTag).not.toBeNull()
    const svg = myTag.children.find(child => child.type === 'element' && child.name === 'svg') as ElementNode
    expect(svg).toBeDefined()
    const rect = svg.children.find(child => child.type === 'element' && child.name === 'svg:rect') as ElementNode
    expect(rect).toBeDefined()
    expect(rect.name).toBe('svg:rect')
    const h1 = element(myTag, 'h1')
    expect(text(h1)).toBe('title')
    const div = element(myTag, 'div')
    expect(text(div)).toBe('content')
    const divC = find(myTag, node => attribute(node, 'id') === 'c')
    expect(divC).not.toBeNull()
  })

  it.each(['template', 'noscript', 'svg', 'math'])('does not close %s with suffixed end tags', wrapper => {
    for (const suffix of ['!', '.foo', '=x']) {
      const root = parse(`<${wrapper}></${wrapper}${suffix}><span id="inner">x</span></${wrapper}><b id="outer">y</b>`)
      expect(find(root, node => attribute(node, 'id') === 'inner')).toBeNull()
      expect(find(root, node => attribute(node, 'id') === 'outer')).not.toBeNull()
    }
  })

  it('treats start tags with invalid characters in name as bogus tags', () => {
    const root = parse('<template!><span id="a">x</span><script.x><p id="b">y</p></script.x>')
    expect(find(root, node => node.name === 'template')).toBeNull()
    expect(find(root, node => node.name === 'script')).toBeNull()
    expect(find(root, node => attribute(node, 'id') === 'a')).not.toBeNull()
    expect(find(root, node => attribute(node, 'id') === 'b')).not.toBeNull()
  })

  it('rejects suffixed closers for raw-text and RCDATA elements', () => {
    const root = parse('<script>var a = 1;</script!><p id="hidden1">x</p></script><script>var b = 2;</scriptx><p id="hidden2">y</p></script><span id="after">ok</span>')
    expect(find(root, node => attribute(node, 'id') === 'hidden1')).toBeNull()
    expect(find(root, node => attribute(node, 'id') === 'hidden2')).toBeNull()
    expect(find(root, node => attribute(node, 'id') === 'after')).not.toBeNull()
  })

  it('closes an element on an end tag with quoted greater-than attribute value', () => {
    const root = parse('<div id="a"></div title=">"><span id="b"></span>')
    const divA = element(root, 'div')
    const spanB = element(root, 'span')
    expect(attribute(divA, 'id')).toBe('a')
    expect(attribute(spanB, 'id')).toBe('b')
    expect(spanB.parent).toBe(root)
    expect(spanB.parent).not.toBe(divA)
    for (const node of descendants(root)) {
      if (node.type === 'text') {
        expect(node.text).not.toContain('">')
      }
    }
  })

  it('discards a bogus start tag with quoted greater-than without leaving text residue', () => {
    const root = parse('<a! href="x>y">text<b id="k"></b>')
    const bK = element(root, 'b')
    expect(attribute(bK, 'id')).toBe('k')
    for (const node of descendants(root)) {
      if (node.type === 'text') {
        expect(node.text).not.toContain('y"')
      }
    }
  })

  it('bounds execution time for long unclosed quoted attribute values', () => {
    const startPattern = '<a! x="'.repeat(200_000)
    const t0 = performance.now()
    const res1 = scanHtml(startPattern)
    const d0 = performance.now() - t0
    expect(d0).toBeLessThan(5000)
    expect(res1.ok).toBe(false)
    if (!res1.ok) expect(['tag-too-long', 'too-many-attrs']).toContain(res1.reason)

    const endPattern = '</div x="'.repeat(200_000)
    const t1 = performance.now()
    const res2 = scanHtml(endPattern)
    const d1 = performance.now() - t1
    expect(d1).toBeLessThan(5000)
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(['tag-too-long', 'too-many-attrs']).toContain(res2.reason)
  })

  it.each(['template', 'noscript', 'svg', 'math'])('does not close %s with bogus tags containing quoted closing tags', wrapper => {
    for (const quotes of ['"', "'"]) {
      for (const tag of [`<a! title=${quotes}></${wrapper}>${quotes}>`, `</a! title=${quotes}></${wrapper}>${quotes}>`]) {
        const root = parse(`<${wrapper}>${tag}<span id="inner">x</span></${wrapper}><b id="outer">y</b>`)
        expect(find(root, node => attribute(node, 'id') === 'inner')).toBeNull()
        expect(find(root, node => attribute(node, 'id') === 'outer')).not.toBeNull()
      }
    }
  })

  it('parses doctype with quoted literals containing greater-than without creating false elements', () => {
    const root = parse('<!DOCTYPE html SYSTEM "about:><div id=\\"x\\">"><p id="after"></p>')
    expect(find(root, node => attribute(node, 'id') === 'x')).toBeNull()
    expect(find(root, node => attribute(node, 'id') === 'after')).not.toBeNull()
    const unquoted = parse('<!DOCTYPE html SYSTEM "about:><div id=x>"><p id="after"></p>')
    expect(find(unquoted, node => attribute(node, 'id') === 'x')).toBeNull()
    expect(find(unquoted, node => attribute(node, 'id') === 'after')).not.toBeNull()
  })

  it('terminates unknown declarations at the first greater-than', () => {
    const root = parse('<!foo "><div id="x"></div>')
    expect(find(root, node => attribute(node, 'id') === 'x')).not.toBeNull()
  })

  it('does not treat backslash as an escape in doctype literals or attribute values', () => {
    const doctype = parse('<!DOCTYPE html SYSTEM \'x\\\'><div>ok</div>')
    expect(find(doctype, node => node.name === 'div')).not.toBeNull()

    const root = parse('<div id="a\\"><p id="b"></p>')
    const div = element(root, 'div')
    expect(attribute(div, 'id')).toBe('a\\')
    expect(find(div, node => attribute(node, 'id') === 'b')).not.toBeNull()
  })

  it('bounds execution time for raw-close tags and doctypes with unclosed quotes', () => {
    const scriptPattern = '<script></script x="'.repeat(150_000)
    const t0 = performance.now()
    const res1 = scanHtml(scriptPattern)
    const d0 = performance.now() - t0
    expect(d0).toBeLessThan(5000)
    expect(typeof res1.ok).toBe('boolean')
    if (!res1.ok) expect(['too-long', 'too-many-nodes', 'too-deep', 'tag-too-long', 'too-many-attrs']).toContain(res1.reason)

    const doctypePattern = '<!doctype "'.repeat(200_000)
    const t1 = performance.now()
    const res2 = scanHtml(doctypePattern)
    const d1 = performance.now() - t1
    expect(d1).toBeLessThan(5000)
    expect(typeof res2.ok).toBe('boolean')
    if (!res2.ok) expect(['too-long', 'too-many-nodes', 'too-deep', 'tag-too-long', 'too-many-attrs']).toContain(res2.reason)
  })

  it('handles whitespace, newlines, and attributes in raw-text and RCDATA closers', () => {
    const scriptSpace = parse('<div><script>a</script ><b>after</b></div>')
    expect(text(scriptSpace)).toBe('after')
    const scriptNewline = parse('<div><script>a</script\n><b>after</b></div>')
    expect(text(scriptNewline)).toBe('after')
    const titleRoot = parse('<title>t</title><p>after</p>')
    expect(text(element(titleRoot, 'title'))).toBe('t')
    expect(text(element(titleRoot, 'p'))).toBe('after')
  })

  it('pops to the nearest open element with the closing name', () => {
    const root = parse('<div><span>a</div><p>x</p>')
    expect(element(root, 'div').parent).toBe(root)
    expect(element(root, 'p').parent).toBe(root)
    expect(text(element(root, 'div'))).toBe('a')
  })

  it('applies the minimal implied end tags', () => {
    const paragraph = parse('<p data-type="w"><div><table></table></div>')
    const p = find(paragraph, node => attribute(node, 'data-type') === 'w')!
    expect(find(p, node => node.name === 'table')).toBeNull()
    expect(find(paragraph, node => node.name === 'table')!.parent!.name).toBe('div')

    const list = parse('<ul><li>a<li>b</ul>')
    const items = findAll(list, node => node.name === 'li')
    expect(items.map(node => text(node))).toEqual(['a', 'b'])
    expect(items.every(node => node.parent!.name === 'ul')).toBe(true)

    const select = parse('<select><option>1<option>2</select>')
    const options = findAll(select, node => node.name === 'option')
    expect(options.map(node => text(node))).toEqual(['1', '2'])
    expect(options.every(node => node.parent!.name === 'select')).toBe(true)

    const rows = parse('<table><tr><td>a<td>b<tr><td>c<td>d</table>')
    const parsed = findAll(rows, node => node.name === 'tr')
    expect(parsed).toHaveLength(2)
    expect(parsed.map(row => childElements(row).map(cell => text(cell)))).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('keeps an implicitly closed tree when the document just ends', () => {
    const root = parse('<div><span>text')
    const div = element(root, 'div')
    expect(div.parent).toBe(root)
    expect(element(root, 'span').parent).toBe(div)
    expect(text(div)).toBe('text')
  })

  it('drops an unterminated tag, comment or raw body exactly once', () => {
    expect(scanHtml('<div class="x').ok).toBe(true)
    expect(find(parse('<div>before<!-- trailing <p>x</p>'), node => node.name === 'p')).toBeNull()
    expect(text(parse('<div>before<!-- trailing <p>x</p>'))).toBe('before')
    expect(find(parse('<div>before<script>var x = 1'), node => node.name === 'script')).not.toBeNull()
    expect(text(parse('<div>before<script>var x = 1'))).toBe('before')
    expect(find(parse('<div>before</div'), node => node.name === 'div')).not.toBeNull()
    expect(find(parse('<div>before<template><p>'), node => node.name === 'p')).toBeNull()
  })
})

describe('htmlScan hard limits', () => {
  it('rejects input longer than the documented maximum', () => {
    expect(scanHtml('x'.repeat(MAX_INPUT_CHARS + 1))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('rejects a document with too many nodes', () => {
    expect(scanHtml('<br>'.repeat(MAX_NODES + 1))).toEqual({ ok: false, reason: 'too-many-nodes' })
  })

  it('rejects nesting deeper than the documented maximum', () => {
    expect(scanHtml('<div>'.repeat(MAX_DEPTH + 1))).toEqual({ ok: false, reason: 'too-deep' })
  })

  it('enforces the tag limit while scanning, not after', () => {
    expect(scanHtml(`<div title="${'a'.repeat(MAX_TAG_CHARS)}">`)).toEqual({ ok: false, reason: 'tag-too-long' })
    expect(scanHtml(`<div ${'a'.repeat(MAX_TAG_CHARS)}>`)).toEqual({ ok: false, reason: 'tag-too-long' })
    expect(scanHtml('<div a="' + 'x'.repeat(100_000))).toEqual({ ok: false, reason: 'tag-too-long' })
    expect(scanHtml('<div a="' + 'x'.repeat(100_000) + '">')).toEqual({ ok: false, reason: 'tag-too-long' })
    expect(scanHtml('<div ' + 'a'.repeat(100_000))).toEqual({ ok: false, reason: 'tag-too-long' })
    // Closing tags are scanned under the same budget, while scanning.
    expect(scanHtml('</div ' + 'a'.repeat(100_000))).toEqual({ ok: false, reason: 'tag-too-long' })
    expect(scanHtml('</div' + 'a'.repeat(100_000) + '>')).toEqual({ ok: false, reason: 'tag-too-long' })
    // A quoted value that ends inside the budget still parses.
    const short = scanHtml('<div a="' + 'x'.repeat(100) + '">')
    expect(short.ok).toBe(true)
    const long = scanHtml('</div ' + 'a'.repeat(100) + '>')
    expect(long.ok).toBe(true)
  })

  it('rejects a tag with too many attributes', () => {
    const attrs = Array.from({ length: MAX_ATTRS + 1 }, (_value, index) => `a${index}="1"`).join(' ')
    expect(scanHtml(`<div ${attrs}>`)).toEqual({ ok: false, reason: 'too-many-attrs' })
    const atLimit = Array.from({ length: MAX_ATTRS }, (_value, index) => `a${index}="1"`).join(' ')
    expect(scanHtml(`<div ${atLimit}>`).ok).toBe(true)
  })
})

describe('htmlScan queries', () => {
  it('sums raw text lengths without decoding and excludes inert subtrees', () => {
    const root = parse('<div> &amp;<span>&#53; </span><template>hidden<span>text</span></template>'
      + '<svg><text>also hidden</text></svg><b>z</b></div>')
    expect(element(root, 'span').rawTextLength).toBe(6)
    expect(element(root, 'div').rawTextLength).toBe(13)
    expect(root.rawTextLength).toBe(13)
    const inert = element(root, 'div').children.filter(node => node.type === 'element' && node.inert)
    expect(inert).toHaveLength(2)
    for (const node of inert) {
      if (node.type === 'element') expect(node.rawTextLength).toBe(0)
    }
    const huge = parse(`<div><span>${'&amp;'.repeat(400_000)}</span></div>`)
    expect(huge.rawTextLength).toBe(2_000_000)
    expect(element(huge, 'div').rawTextLength).toBe(2_000_000)
  })

  it('counts an inert subtree only once in the candidate budget', () => {
    const root = parse(`<div>heading<svg>${'<path/>'.repeat(100)}</svg><span>label</span></div>`)
    expect(element(root, 'div').size).toBe(4)
    expect(root.size).toBe(5)
    expect(text(root)).toBe('headinglabel')
  })
  it('returns descendants in document order', () => {
    const root = parse('<div><p>a</p><section><p>b</p></section></div>')
    const names = [...descendants(root)].filter(node => node.type === 'element').map(node => node.name)
    expect(names).toEqual(['div', 'p', 'section', 'p'])
    expect(findAll(root, node => node.name === 'p').map(node => text(node))).toEqual(['a', 'b'])
  })

  it('walks siblings and ancestors without counting text', () => {
    const root = parse('<div><a></a> gap <b><i></i></b><c></c></div>')
    const a = element(root, 'a'), b = element(root, 'b')
    expect(nextElementSibling(a)).toBe(b)
    expect(nextElementSibling(b)).toBe(element(root, 'c'))
    expect(nextElementSibling(element(root, 'c'))).toBeNull()
    expect(childElements(element(root, 'div')).map(node => node.name)).toEqual(['a', 'b', 'c'])
    const closestAncestor = closest(element(root, 'i'), node => node.name === 'div')
    expect(closestAncestor).toBe(element(root, 'div'))
    expect(closest(element(root, 'i'), node => node.name === 'a')).toBeNull()
  })

  it('walks a long sibling list in linear time', () => {
    const root = parse(`<div>${'<p></p>'.repeat(40_000)}<span></span></div>`)
    const div = element(root, 'div')
    const siblings = childElements(div)
    expect(siblings).toHaveLength(40_001)
    const started = performance.now()
    let node: ElementNode | null = siblings[0]!
    let steps = 0
    while (node !== null) {
      steps++
      node = nextElementSibling(node)
    }
    expect(steps).toBe(40_001)
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('matches class tokens only from the real class attribute', () => {
    const root = parse('<div title="class=\'block\'"><p class="block-body  x"></p></div>')
    const div = element(root, 'div')
    expect(hasClass(div, 'block')).toBe(false)
    expect(hasClass(element(root, 'p'), 'block-body')).toBe(true)
    expect(hasClass(element(root, 'p'), 'block')).toBe(false)
  })

  it('decodes named, decimal and hexadecimal character references', () => {
    const root = parse('<p> &amp;&lt;&gt;&quot;&#39;&nbsp; </p>')
    expect(text(root)).toBe(`&<>"'`)
    expect(text(parse('<p>&amp;lt;</p>'))).toBe('&lt;')
    expect(text(parse('<p>&#53;&#x35;</p>'))).toBe('55')
    expect(text(parse('<p>&#x1F600;</p>'))).toBe('😀')
    expect(text(parse('<p>&#0;&#xD800;&#x110000;</p>'))).toBe('\ufffd\ufffd\ufffd')
    expect(text(parse('<p>&#12345678;</p>'))).toBe('&#12345678;')
    expect(attribute(element(parse('<div data-x="&#53;&#x36;"></div>'), 'div'), 'data-x')).toBe('56')
    expect(text(parse('<p>&constructor;&toString;&__proto__;</p>'))).toBe('&constructor;&toString;&__proto__;')
  })

  it('never decodes an entity beyond the remaining raw-work budget', () => {
    const root = parse('<p>x&amp;y</p>')
    expect(readText(root, 20, 5)).toEqual({ value: 'x&amp', truncated: true })
    expect(readText(root, 20, 6)).toEqual({ value: 'x&', truncated: true })
    expect(readText(root, 20, 7)).toEqual({ value: 'x&y', truncated: false })
    expect(readText(parse('<p>&#x1F600;</p>'), 20, 9)).toEqual({ value: '😀', truncated: false })
    expect(readText(parse('<p>&#x1F600;</p>'), 20, 8)).toEqual({ value: '&#x1F600', truncated: true })
    const split = parse('<p>&amp;<span>&amp;</span></p>')
    expect(readText(split, 20, 9)).toEqual({ value: '&&amp', truncated: true })
  })

  it('streams huge entity runs under the output and raw-work budgets', () => {
    const root = parse(`<p>${'&amp;'.repeat(400_000)}</p>`)
    const started = performance.now()
    expect(readText(root, 120)).toEqual({ value: '&'.repeat(120), truncated: true })
    expect(performance.now() - started).toBeLessThan(5000)
    const spaces = parse(`<p>${'&nbsp;'.repeat(400_000)}</p>`)
    const spaceStarted = performance.now()
    expect(readText(spaces, 120).truncated).toBe(true)
    expect(performance.now() - spaceStarted).toBeLessThan(5000)
  })

  it('removes marks and collapses whitespace', () => {
    expect(text(parse('<p>a\u200bb\u200fc\u2066d</p>'))).toBe('abcd')
    expect(text(parse('<p>\n  a \t b  \n</p>'))).toBe('a b')
  })

  it('normalises whitespace in a stream, so runs never consume the cap', () => {
    // A whitespace run between digits must not truncate the value into "5".
    const spaced = parse(`<p>5${' '.repeat(5000)}6</p>`)
    expect(text(spaced, 64)).toBe('5 6')
    expect(readText(spaced, 64)).toEqual({ value: '5 6', truncated: false })
    // Leading whitespace disappears without shortening the collected value.
    const padded = parse(`<p>${' '.repeat(5000)}<span class="meta-value">5</span></p>`)
    expect(text(padded, 64)).toBe('5')
    const inner = parse(`<p>a${' '.repeat(500)}b</p>`)
    expect(text(inner, 400)).toBe('a b')
  })

  it('reports truncation instead of silently cutting a value', () => {
    const long = parse(`<p>${'a'.repeat(100)}</p>`)
    expect(readText(long, 10)).toEqual({ value: 'aaaaaaaaaa', truncated: true })
    expect(readText(long, 100)).toEqual({ value: 'a'.repeat(100), truncated: false })
    expect(readText(parse('<p>5 6</p>'), 3)).toEqual({ value: '5 6', truncated: false })
    // Exhausting the raw-work budget is reported too, even with no output.
    const spacesOnly = parse(`<p>${' '.repeat(TEXT_RAW_BUDGET + 50_000)}</p>`)
    expect(readText(spacesOnly, 400)).toEqual({ value: '', truncated: true })
  })

  it('stops collecting text after the requested length', () => {
    const root = parse(`<p>${'a'.repeat(5000)}</p><p>${'ب'.repeat(300)}</p>`)
    expect(text(element(root, 'p'), 100)).toHaveLength(100)
    expect(text(element(root, 'p'), 7000)).toHaveLength(5000)
    expect(text(findAll(root, node => node.name === 'p')[1]!, 10)).toHaveLength(10)
    const huge = parse(`<p>${'x'.repeat(1_000_000)}</p>`)
    const started = performance.now()
    expect(text(huge, 10)).toBe('xxxxxxxxxx')
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('htmlScan never throws', () => {
  it('survives seeded random markup within the time bound', () => {
    const fragments = ['<', '>', '/', '"', "'", '=', '!', '-', '[', ']', 'div', 'p', 'script', 'textarea',
      'template', 'svg', 'math', 'noscript', 'title', '/>', '<![CDATA[', ' class=', ' id=', 'x', ' ']
    let seed = 20261111
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    for (let round = 0; round < 2000; round++) {
      let html = ''
      const parts = random() % 24
      for (let index = 0; index < parts; index++) html += fragments[random() % fragments.length]
      const started = performance.now()
      expect(() => scanHtml(html)).not.toThrow()
      expect(performance.now() - started).toBeLessThan(200)
    }
  })
})
