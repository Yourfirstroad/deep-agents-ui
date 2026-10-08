"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_DENOISE_CONFIG,
  StandaloneConfig,
  type DenoiseConfig,
} from "@/lib/config";

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: StandaloneConfig) => void;
  initialConfig?: StandaloneConfig;
}

export function ConfigDialog({
  open,
  onOpenChange,
  onSave,
  initialConfig,
}: ConfigDialogProps) {
  const [deploymentUrl, setDeploymentUrl] = useState(
    initialConfig?.deploymentUrl || ""
  );
  const [assistantId, setAssistantId] = useState(
    initialConfig?.assistantId || ""
  );
  const [langsmithApiKey, setLangsmithApiKey] = useState(
    initialConfig?.langsmithApiKey || ""
  );
  const [denoise, setDenoise] = useState<DenoiseConfig>(
    initialConfig?.denoise ?? DEFAULT_DENOISE_CONFIG
  );

  useEffect(() => {
    if (open && initialConfig) {
      setDeploymentUrl(initialConfig.deploymentUrl);
      setAssistantId(initialConfig.assistantId);
      setLangsmithApiKey(initialConfig.langsmithApiKey || "");
      setDenoise(initialConfig.denoise ?? DEFAULT_DENOISE_CONFIG);
    }
  }, [open, initialConfig]);

  const handleSave = () => {
    if (!deploymentUrl || !assistantId) {
      alert("请填写所有必填字段");
      return;
    }

    onSave({
      deploymentUrl,
      assistantId,
      langsmithApiKey: langsmithApiKey || undefined,
      denoise,
    });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>配置</DialogTitle>
          <DialogDescription>
            配置 LangGraph 部署信息。这些设置将保存在浏览器本地存储中。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="deploymentUrl">部署地址</Label>
            <Input
              id="deploymentUrl"
              placeholder="https://<deployment-url>"
              value={deploymentUrl}
              onChange={(e) => setDeploymentUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="assistantId">助手 ID</Label>
            <Input
              id="assistantId"
              placeholder="<assistant-id>"
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="langsmithApiKey">
              LangSmith API 密钥{" "}
              <span className="text-muted-foreground">（可选）</span>
            </Label>
            <Input
              id="langsmithApiKey"
              type="password"
              placeholder="lsv2_pt_..."
              value={langsmithApiKey}
              onChange={(e) => setLangsmithApiKey(e.target.value)}
            />
          </div>

          <div className="mt-2 border-t pt-4">
            <div className="mb-3 flex items-center justify-between">
              <Label htmlFor="denoiseEnabled">文档降噪(去页眉页脚/水印/页码)</Label>
              <Switch
                id="denoiseEnabled"
                checked={denoise.enabled}
                onCheckedChange={(v) =>
                  setDenoise((d) => ({ ...d, enabled: v }))
                }
              />
            </div>
            <div className="mb-3 flex items-center justify-between">
              <Label htmlFor="pictureDescription">
                图片理解(千问 VL 描述图中内容,慢但更全)
              </Label>
              <Switch
                id="pictureDescription"
                checked={denoise.pictureDescription}
                onCheckedChange={(v) =>
                  setDenoise((d) => ({ ...d, pictureDescription: v }))
                }
              />
            </div>
            {denoise.enabled && (
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="repeatMinPages" className="text-xs">
                    重复文本最少页数
                  </Label>
                  <Input
                    id="repeatMinPages"
                    type="number"
                    min={2}
                    value={denoise.repeatMinPages}
                    onChange={(e) =>
                      setDenoise((d) => ({
                        ...d,
                        repeatMinPages: Number(e.target.value) || DEFAULT_DENOISE_CONFIG.repeatMinPages,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="repeatMaxlen" className="text-xs">
                    重复文本长度上限
                  </Label>
                  <Input
                    id="repeatMaxlen"
                    type="number"
                    min={10}
                    value={denoise.repeatMaxlen}
                    onChange={(e) =>
                      setDenoise((d) => ({
                        ...d,
                        repeatMaxlen: Number(e.target.value) || DEFAULT_DENOISE_CONFIG.repeatMaxlen,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="maxDeleteRatio" className="text-xs">
                    删除占比刹车(0-1)
                  </Label>
                  <Input
                    id="maxDeleteRatio"
                    type="number"
                    step={0.05}
                    min={0.05}
                    max={1}
                    value={denoise.maxDeleteRatio}
                    onChange={(e) =>
                      setDenoise((d) => ({
                        ...d,
                        maxDeleteRatio: Number(e.target.value) || DEFAULT_DENOISE_CONFIG.maxDeleteRatio,
                      }))
                    }
                  />
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              参数不懂就保持默认;删除占比超过刹车值时整单保留原文(宁留勿删)。
              图片多的大文档解析慢主要是「图片理解」阶段,赶时间可以关掉,提速 3-5 倍。
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
