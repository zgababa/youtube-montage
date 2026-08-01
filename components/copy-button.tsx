"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface CopyButtonProps {
  value: string
  label?: string
  size?: "sm" | "icon-sm" | "xs" | "icon-xs"
}

export function CopyButton({
  value,
  label = "Copy",
  size = "icon-sm",
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const iconOnly = size.startsWith("icon")

  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
  }

  const button = (
    <Button
      variant="ghost"
      size={size}
      onClick={copy}
      aria-label={iconOnly ? label : undefined}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        strokeWidth={2}
        data-icon={iconOnly ? undefined : "inline-start"}
      />
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  )

  if (!iconOnly) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}
