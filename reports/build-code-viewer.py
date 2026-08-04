#!/usr/bin/env python3
"""line-bot/Code.gs と README.md から閲覧用の1枚ページを生成する。

GASエディタへ貼り付けるコードを、コピーボタン付きで画面上に出すためのもの。
Code.gs を直したら再実行して reports/line-bot-code-viewer.html を作り直す。

    python3 reports/build-code-viewer.py

テンプレートは reports/code-viewer.tpl.html。
"""

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE = ROOT / 'line-bot' / 'Code.gs'
META = ROOT / 'line-bot' / 'MetaInsights.gs'
README = ROOT / 'line-bot' / 'README.md'
TEMPLATE = ROOT / 'reports' / 'code-viewer.tpl.html'
OUTPUT = ROOT / 'reports' / 'line-bot-code-viewer.html'

# 過去に平文で混入していたトークンの断片。二度と載せないための番人。
FORBIDDEN = ('E12LZIQJ',)


def inline_markdown(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    return text


def render_markdown(source: str) -> str:
    """READMEを表示するのに足りるだけの最小限の変換。"""
    out: list[str] = []
    fence: list[str] = []
    in_code = False
    in_list = False

    for line in source.split('\n'):
        if line.startswith('```'):
            if in_code:
                out.append('<pre class="blk"><code>' + html.escape('\n'.join(fence)) + '</code></pre>')
                fence, in_code = [], False
            else:
                if in_list:
                    out.append('</ul>')
                    in_list = False
                in_code = True
            continue

        if in_code:
            fence.append(line)
            continue

        bullet = None
        if line.startswith('- '):
            bullet = line[2:]
        elif re.match(r'^\d+\. ', line):
            bullet = re.sub(r'^\d+\. ', '', line)

        if bullet is not None:
            if not in_list:
                out.append('<ul>')
                in_list = True
            out.append('<li>' + inline_markdown(bullet) + '</li>')
            continue

        if in_list:
            out.append('</ul>')
            in_list = False

        stripped = line.strip()
        if not stripped:
            continue
        if stripped == '---':
            out.append('<hr>')
        elif stripped.startswith('### '):
            out.append('<h3>' + inline_markdown(stripped[4:]) + '</h3>')
        elif stripped.startswith('## '):
            out.append('<h2>' + inline_markdown(stripped[3:]) + '</h2>')
        elif stripped.startswith('# '):
            out.append('<h1>' + inline_markdown(stripped[2:]) + '</h1>')
        else:
            out.append('<p>' + inline_markdown(stripped) + '</p>')

    if in_list:
        out.append('</ul>')
    return '\n'.join(out)


def main() -> int:
    code = CODE.read_text(encoding='utf-8')
    meta = META.read_text(encoding='utf-8')
    readme = README.read_text(encoding='utf-8')

    for name, text in (('Code.gs', code), ('MetaInsights.gs', meta), ('README.md', readme)):
        for secret in FORBIDDEN:
            if secret in text:
                print(f'中止：{name} に秘密情報が含まれています。', file=sys.stderr)
                return 1
        # コードは <script> 内に JSON として埋め込む。'</' があるとタグを閉じてしまう。
        if '</' in text and name != 'README.md':
            print(f"中止：{name} に '</' が含まれており、埋め込むとタグが壊れます。", file=sys.stderr)
            return 1

    page = TEMPLATE.read_text(encoding='utf-8')
    page = (page
            .replace('{{CODE_JSON}}', json.dumps(code))
            .replace('{{META_CODE_JSON}}', json.dumps(meta))
            .replace('{{CODE}}', html.escape(code))
            .replace('{{META_CODE}}', html.escape(meta))
            .replace('{{README}}', render_markdown(readme))
            .replace('{{LINES}}', str(code.count('\n') + 1))
            .replace('{{META_LINES}}', str(meta.count('\n') + 1)))

    OUTPUT.write_text(page, encoding='utf-8')
    print(f'{OUTPUT.relative_to(ROOT)} を生成しました'
          f'（Code.gs {code.count(chr(10)) + 1} 行 / '
          f'MetaInsights.gs {meta.count(chr(10)) + 1} 行 / '
          f'{round(len(page.encode()) / 1024)} KB）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
