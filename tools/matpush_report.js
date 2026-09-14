#!/usr/bin/env node
/* matpush_report.js — 晚间作业未交推送的数据侧脚本(matpush-2026-09-14)
 * 流程：匿名读 hr_classpass 拿访客凭据 → Supabase Auth 访客登录 →
 *       拉 hr_students / hr_materials / hr_settings → 按「📋 今日未交」同款口径
 *       算出当天所有「作业提交」类事项的未交/迟交/请假名单 → 输出推送文案。
 * 用法：
 *   node deploy/matpush_report.js                     # 干跑：只打印结果(JSON)
 *   node deploy/matpush_report.js --push SCTxxxx      # 有未交时调 Server酱推送到微信
 * 口径(与 matDayPick/matNotifyText 严格一致)：
 *   - 未交 = 当天该事项登记为「未交」的学生
 *   - 迟交 = 登记为「迟交」；请假 = 未登记且当天任一时段请假(单列，不算未交)
 *   - 未登记且未请假 = 空格，不算未交(与应用一致)
 *   - 只统计文件夹类型 === "作业提交"(材料上交类不推)
 *   - 有未交/迟交才值得推；全交齐或当天无登记 → push:false
 */
'use strict';
const SUPABASE_URL = 'https://ffuslbsknqqsjqjbvpjr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gpIn1xpywnjQnxP-OM_s-Q_Gz9Gj6L-';
const CLS_CODE = 'mghb7y';            // 初一(9)班 扫码班级码
const CLS_NAME = '初一(9)班';
const MAT_TYPE = '作业提交';

function localDate() {
  // 用北京时间算「今天」，机器时区无关
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); // YYYY-MM-DD
}
async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch (_e) { j = null; }
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('?')[0] + ' :: ' + txt.slice(0, 300));
  return j;
}
async function main() {
  const pushKey = (() => { const i = process.argv.indexOf('--push'); return i > 0 ? String(process.argv[i + 1] || '').trim() : ''; })();
  const date = localDate();
  const H = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };

  // 1. 匿名读班级口令(hr_classpass 允许匿名读)
  const pass = await jfetch(SUPABASE_URL + '/rest/v1/hr_classpass?select=data', { headers: H });
  const row = (pass || []).map(x => x.data || {}).find(d => String(d.code || '') === CLS_CODE);
  if (!row || !row.email || !row.pwd) throw new Error('hr_classpass 里找不到班级码 ' + CLS_CODE + ' 的访客凭据');

  // 2. 访客登录
  const auth = await jfetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: H, body: JSON.stringify({ email: row.email, password: row.pwd, gotrue_meta_security: {} })
  });
  const token = auth.access_token;
  if (!token) throw new Error('访客登录失败：无 access_token');
  const HU = Object.assign({}, H, { Authorization: 'Bearer ' + token });

  // 3. 拉数据(并行)
  const [stuRes, matRes, setRes] = await Promise.all([
    jfetch(SUPABASE_URL + '/rest/v1/hr_students?select=data', { headers: HU }),
    jfetch(SUPABASE_URL + '/rest/v1/hr_materials?select=data', { headers: HU }),
    jfetch(SUPABASE_URL + '/rest/v1/hr_settings?select=data', { headers: HU })
  ]);
  const students = (stuRes || []).map(x => x.data || {}).filter(s => String(s['学号'] || '').trim());
  const materials = (matRes || []).map(x => x.data || {});
  const settings = ((setRes || [])[0] || {}).data || {};
  const folders = Array.isArray(settings.matFolders) ? settings.matFolders : [];
  const leaves = settings.leaves || {};

  // 4. 请假数据：LEAVE[date] = { ts, list: { 去零号数: { n, r, p } } }
  const noKey = no => String(parseInt(no, 10) || String(no).trim());
  const dayLeave = leaves[date] && leaves[date].list ? leaves[date].list : {};
  const leavePartOf = no => { const o = dayLeave[noKey(no)]; if (!o) return null; const p = String(o.p || '全天'); return ['全天', '上午', '下午'].indexOf(p) >= 0 ? p : '全天'; };

  // 5. 事项集合：作业提交类文件夹 ∪ 当天记录里出现过的作业提交事项
  const itemSet = new Map(); // item -> {item, type}
  folders.forEach(f => { if (f && (f.type || MAT_TYPE) === MAT_TYPE && String(f.item || '').trim()) itemSet.set(String(f.item).trim(), { item: String(f.item).trim(), type: MAT_TYPE }); });
  materials.forEach(r => {
    if (String(r['日期'] || '').slice(0, 10) !== date) return;
    if ((r['类型'] || MAT_TYPE) !== MAT_TYPE) return;
    const it = String(r['事项'] || '').trim(); if (it && !itemSet.has(it)) itemSet.set(it, { item: it, type: MAT_TYPE });
  });
  if (!itemSet.size) { console.log(JSON.stringify({ push: false, date, reason: '今天没有「作业提交」类事项(无文件夹也无记录)' }, null, 2)); return; }

  // 6. 逐事项按口径算名单
  const todayRecs = materials.filter(r => String(r['日期'] || '').slice(0, 10) === date);
  const lines = [], detail = [];
  itemSet.forEach(({ item }) => {
    const un = [], late = [], lv = [];
    students.forEach(s => {
      const no = String(s['学号'] || '').trim(); if (!no) return;
      const name = String(s['姓名'] || '').trim() || (no + '号');
      const rec = todayRecs.find(r => String(r['事项'] || '').trim() === item
        && (r['类型'] || MAT_TYPE) === MAT_TYPE
        && String(r['学号'] || '').trim() === no);
      if (!rec) {
        if (leavePartOf(no)) lv.push({ no, name, part: leavePartOf(no), why: String((dayLeave[noKey(no)] || {}).r || '') });
        return; // 未登记且未请假 = 空格，不算未交
      }
      const v = String(rec['状态'] || '');
      if (v === '未交') un.push({ no, name });
      else if (v === '迟交') late.push({ no, name });
    });
    if (!un.length && !late.length) return;   // 该事项没毛病就不提
    const fm = list => list.map(x => x.no + '号').join('、');   // 只要号数不带姓名（用户要求）
    const seg = [];
    if (un.length) seg.push('❌ 未交（' + un.length + '人）：' + fm(un));
    if (late.length) seg.push('⏰ 迟交（' + late.length + '人）：' + fm(late));
    if (lv.length) seg.push('🩺 请假（' + lv.length + '人）：' + lv.map(x => x.no + '号' + (x.part && x.part !== '全天' ? '(' + x.part + ')' : '')).join('、'));
    lines.push('📝 ' + item + '\n' + seg.join('\n'));
    detail.push({ item, un, late, leave: lv });
  });

  if (!lines.length) { console.log(JSON.stringify({ push: false, date, reason: '今天所有作业事项都已交齐(或仅请假豁免)，未交/迟交均为 0' }, null, 2)); return; }

  const title = CLS_NAME + ' 作业未交提醒（' + date.slice(5).replace('-', '/') + '）';
  const desp = '**' + title + '**\n\n' + lines.join('\n\n')
    + '\n\n> 数据来自班级小台「材料收集」，口径与「📋 今日未交」一致：请假豁免、迟交单列。';

  // 7. 输出 / 推送
  const result = { push: true, date, title, desp, items: detail, clsName: CLS_NAME };
  console.log(JSON.stringify(result, null, 2));
  if (pushKey) {
    const body = new URLSearchParams({ title, desp });
    const sr = await fetch('https://sctapi.ftqq.com/' + encodeURIComponent(pushKey) + '.send', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
    });
    const st = await sr.text();
    if (!sr.ok) throw new Error('Server酱推送失败 HTTP ' + sr.status + ' :: ' + st.slice(0, 300));
    console.error('SERVERCHAN_OK ' + st.slice(0, 200));
  }
}
main().catch(e => { console.error('MATPUSH_ERROR ' + (e && e.message || e)); process.exit(1); });
