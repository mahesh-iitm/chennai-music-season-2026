import re, sys, os, subprocess, concurrent.futures as cf
idx, out = sys.argv[1], sys.argv[2]
ids = sorted(set(re.findall(r'VALUE="(c\d+)\.shtml"', open(idx, encoding='latin-1').read())))
def get(i):
    p = os.path.join(out, i + '.html')
    if os.path.exists(p) and os.path.getsize(p) > 1000: return 0
    for _ in range(3):
        r = subprocess.run(['curl','-s','-m','30','-o',p,'-w','%{http_code}',f'https://www.karnatik.com/{i}.shtml'],capture_output=True,text=True)
        if r.stdout == '200': return 0
    return 1
with cf.ThreadPoolExecutor(16) as ex: fails = sum(ex.map(get, ids))
print(len(ids), 'fails', fails)
