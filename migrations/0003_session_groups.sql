-- 在会话上缓存登录时从身份服务取到的权限组/角色，供后台权限判定使用。
-- 既有会话默认空数组，过期后由新登录补齐。
ALTER TABLE sessions ADD COLUMN user_groups TEXT NOT NULL DEFAULT '[]';
