"use client";

import { useState, useEffect } from "react";
import { BookOpen, Link as LinkIcon, FileText, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ONBOARDED_KEY = "organize:onboarded";

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const onboarded = localStorage.getItem(ONBOARDED_KEY);
    if (onboarded !== "1") {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setOpen(false);
  };

  const handleSkip = () => {
    handleClose();
  };

  const handleNext = () => {
    if (step < 2) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const openOnboarding = () => {
    localStorage.removeItem(ONBOARDED_KEY);
    setStep(0);
    setOpen(true);
  };

  if (typeof window !== "undefined") {
    (window as any).openOnboarding = openOnboarding;
  }

  const steps = [
    {
      title: "欢迎使用 Organize",
      description: "你的一站式稍后读 + 笔记工具。保存网页、阅读学习、记录灵感。",
      content: (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="h-16 w-16 text-primary mx-auto mb-6 flex items-center justify-center rounded-full bg-primary/10">
            <BookOpen className="h-10 w-10" />
          </div>
          <DialogTitle className="text-2xl font-bold text-center mb-2">
            欢迎使用 Organize
          </DialogTitle>
          <DialogDescription className="text-center text-base max-w-sm">
            你的一站式稍后读 + 笔记工具。保存网页、阅读学习、记录灵感。
          </DialogDescription>
        </div>
      ),
      buttonText: "开始使用",
    },
    {
      title: "如何使用",
      description: "了解核心功能",
      content: (
        <div className="py-4">
          <DialogTitle className="text-xl font-bold text-center mb-4">
            如何使用
          </DialogTitle>
          <div className="grid gap-4">
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-950/50">
                <LinkIcon className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">保存文章</h3>
                <p className="text-sm text-muted-foreground">粘贴链接到收集箱，自动抓取正文</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950/50">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">做笔记</h3>
                <p className="text-sm text-muted-foreground">Notion 风格编辑器，随时记录想法</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg bg-green-100 dark:bg-green-950/50">
                <ListChecks className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">任务管理</h3>
                <p className="text-sm text-muted-foreground">工作学习待办，学习闭环</p>
              </div>
            </div>
          </div>
        </div>
      ),
      buttonText: "下一步",
    },
    {
      title: "快捷键提升效率",
      description: "常用快捷键一览",
      content: (
        <div className="py-4">
          <DialogTitle className="text-xl font-bold text-center mb-4">
            快捷键提升效率
          </DialogTitle>
          <div className="space-y-3">
            {[
              { keys: ["⌘", "K"], description: "打开命令面板" },
              { keys: ["⌘", "N"], description: "快速添加" },
              { keys: ["G", "I/N/L/T/D/E"], description: "快速导航" },
              { keys: ["?"], description: "查看所有快捷键" },
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <span className="text-sm">{item.description}</span>
                <div className="flex items-center gap-1">
                  {item.keys.map((key, kidx) => (
                    <kbd
                      key={kidx}
                      className="px-2 py-1 text-xs font-semibold bg-muted border rounded"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
      buttonText: "立即开始",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="max-w-lg p-0 gap-0 overflow-hidden"
        hideCloseButton={true}
      >
        <button
          onClick={handleSkip}
          className="absolute right-4 top-4 z-10 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          跳过
        </button>

        <div className="p-6">
          {steps[step].content}

          <div className="flex items-center justify-center gap-2 my-4">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  "h-2 w-2 rounded-full transition-all duration-200",
                  idx === step
                    ? "w-6 bg-primary"
                    : "bg-muted hover:bg-muted-foreground/30 cursor-pointer"
                )}
                onClick={() => setStep(idx)}
              />
            ))}
          </div>

          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <Button variant="outline" onClick={handleBack} className="flex-1">
                上一步
              </Button>
            )}
            <Button onClick={handleNext} className="flex-1">
              {steps[step].buttonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function resetOnboarding() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(ONBOARDED_KEY);
    window.location.reload();
  }
}
