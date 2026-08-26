import { redirect } from "next/navigation";

// 收集箱已并入「稍后读」（/library）：快速添加条在列表页顶部，
// 保留此路由仅作存量链接/书签的兼容重定向。
export default function InboxPage() {
  redirect("/library");
}
