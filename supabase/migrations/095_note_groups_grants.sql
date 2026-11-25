-- 095: 补 094（笔记分组）的表级授权与 anon 收口。
--
-- 094 只建了表、RLS 与策略，没有任何 GRANT / REVOKE，与「每张新表必须显式 GRANT」的约定
-- （AGENTS.md；090 / 092 的写法）不一致。CI 实测（CLI 2.116.0）：平台默认权限目前仍会把新表
-- 暴露给 anon 和 authenticated，所以功能没有坏；缺的是两件事——
--   - anon 残留两张表的全部表级权限。策略按 auth.uid() 判定，anon 读不到也写不进，
--     但表级权限该收就得收（口径同 090 / 092）。
--   - 没有显式授权。config.toml 注明新默认是不自动暴露新表，到那时这两张表会整体不可用；
--     显式写出来才不依赖平台默认。
-- 094 没有任何 pgTAP 引用，mock 模式又不走表级权限，所以此前无从发现（见 095_note_groups.test.sql）。
-- 已应用的迁移不改，用新迁移补。

-- ========== GRANT / anon 收口（沿 090 / 092 约定）==========
grant select, insert, update, delete on public.note_groups to authenticated;
grant select, insert, update, delete on public.note_group_members to authenticated;
revoke all on table public.note_groups from anon;
revoke all on table public.note_group_members from anon;
