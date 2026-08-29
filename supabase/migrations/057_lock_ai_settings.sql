-- 057 AI 密钥与地址安全（P0-03）
--
-- api_key 不再允许客户端角色读取（浏览器只拿掩码，见 /api/ai/settings）：
--   - 收回 authenticated / anon 对 user_ai_settings 的全部表权限
--   - 服务端读写一律经 /api/ai/settings 与 getAIConfig（service_role 客户端）
--   - base_url 的 SSRF 校验在应用层：保存时（本接口）+ 每次调用时（safeAIRequest
--     逐跳校验并地址钉扎）
-- 注意：撤销客户端 SELECT 后，前端直查该表会 401/权限拒绝——属预期，
-- 设置页已改为走 /api/ai/settings。

revoke select, insert, update, delete on public.user_ai_settings from authenticated;
revoke select, insert, update, delete on public.user_ai_settings from anon;
grant all on public.user_ai_settings to service_role;
