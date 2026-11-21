import re, os, sys, html
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
base = sys.argv[1]
idx = open(os.path.join(base,'idx.html'), encoding='latin-1').read()
entries = re.findall(r'<OPTION VALUE="(c\d+)\.shtml">([^\n<]*)', idx)
def txt(s):
    s = re.sub(r'<script.*?</script>', ' ', s, flags=re.S|re.I)
    s = re.sub(r'<br\s*/?>|<p>|</p>|<tr>|</td>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    return html.unescape(s)
def field(t, pat):
    m = re.search('(?:' + pat + ')' + r'[ \t]*:[ \t]*([^\n]*)', t, re.I)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else ''
rows = []; seen=set()
for cid, label in entries:
    if cid in seen: continue
    seen.add(cid)
    parts = [p.strip() for p in label.strip().split(' - ')]
    title = parts[0]; idx_raga = parts[1] if len(parts)>2 else ''; idx_comp = parts[-1] if len(parts)>=3 else ''
    raga=tala=lang=comp=''; status='OK'
    p = os.path.join(base,'pages',cid+'.html')
    if os.path.exists(p) and os.path.getsize(p) > 1000:
        t = txt(open(p, encoding='latin-1').read())
        raga = field(t, r'\br[aA]+gam'); tala = field(t, r'\bt[aA]+[lL][aA]*m'); lang = field(t, r'Language'); comp = field(t, r'Composer')
        # trim spillover where fields run together on one line
        for k in ('raga','tala'):
            v = locals()[k]; v = re.split(r'\s*(taaLam|taLam|taalam|Composer|Language)\s*:', v, flags=re.I)[0].strip()
            if k=='raga': raga=v
            else: tala=v
    else: status='Page not found on site'
    rows.append([int(cid[1:]), cid, title, raga or idx_raga, tala, comp or idx_comp, lang, f'https://www.karnatik.com/{cid}.shtml', status])
rows.sort(key=lambda r: r[2].lower())
wb = Workbook(); ws = wb.active; ws.title = 'Songs'
hdr = ['ID','Page code','Song title','Raga','Taala','Composer','Language','Link','Notes']
ws.append(hdr)
for r in rows: ws.append(r)
f = Font(name='Arial', size=10); hf = Font(name='Arial', size=10, bold=True, color='FFFFFF')
for row in ws.iter_rows():
    for c in row: c.font = f
for c in ws[1]: c.font = hf; c.fill = PatternFill('solid', start_color='305496'); c.alignment = Alignment(vertical='center')
for i,r in enumerate(rows, start=2):
    ws.cell(i,8).hyperlink = r[7]; ws.cell(i,8).font = Font(name='Arial', size=10, color='0563C1', underline='single')
for col,w in zip('ABCDEFGHI',[8,10,42,24,22,26,12,38,22]): ws.column_dimensions[col].width = w
ws.freeze_panes = 'A2'; ws.auto_filter.ref = f'A1:I{len(rows)+1}'
s = wb.create_sheet('About')
for line in ['Source: https://www.karnatik.com/lyrics.shtml (index of %d songs), scraped %s' % (len(rows), '19 Nov 2026'),
             'ID = number in the song page URL (e.g. c1373.shtml -> 1373).',
             'Song title and composer from the index page; raga, taala and language from each song page (spellings as on the site).',
             'Ragamalika / multi-raga songs: Raga shows the first raga label on the page.',
             'Songs with Notes = "Page not found on site" have dead links on karnatik.com; raga/composer from the index only.']:
    s.append([line]); s.cell(s.max_row,1).font = f
s.column_dimensions['A'].width = 120
out = sys.argv[2]; wb.save(out)
import collections
print(len(rows), 'empty tala', sum(1 for r in rows if not r[4]), 'empty raga', sum(1 for r in rows if not r[3]))
print(collections.Counter(r[4] for r in rows).most_common(12))
print(collections.Counter(r[6] for r in rows).most_common(8))
for r in rows[:5]: print(r)
