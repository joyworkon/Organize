import { redirect } from "next/navigation";

// 经验列表已并入待办工作台 /tasks/lessons，旧入口重定向保持深链兼容
export default function LessonsPageRedirect() {
  redirect("/tasks/lessons");
}
