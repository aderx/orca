import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { toast } from 'sonner'
import type { PluginWorkspaceContext } from './plugin-workspace-context'
import {
  callPanelActionViaPreload,
  type PanelActionCall
} from '../plugins/frames/plugin-frame-host'
import {
  pluginFrameWindowOf,
  type PluginFrameElement
} from '../plugins/frames/plugin-frame-element'
import { FRAME_EVENTS } from '../../../../shared/plugins/frames/plugin-frame-bridge'
import {
  pluginEvent,
  type PluginHostCallOutcome
} from '../../../../shared/plugins/frames/plugin-protocol'
import { isPluginJsonObject } from '../../../../shared/plugins/manifest/plugin-json-object'

export type WorkspacePluginFrameProps = {
  workspaceContext?: PluginWorkspaceContext
  isVisible?: boolean
  presentation?: string
  onDismiss?: () => void
  onContentHeight?: (height: number) => void
  contentHeight?: number
}

function showError(message: string): void {
  const summary = message
    .replace(/^Error:\s*/, '')
    .split(/\n\s*at\s/)[0]
    .slice(0, 1000)
  toast.error(summary, { id: `plugin-panel:${summary}` })
}

/** Bind requests to the workspace owning this view, including replies after a popover closes. */
export function useWorkspacePluginFrame(
  props: WorkspacePluginFrameProps,
  frameRef: RefObject<PluginFrameElement | null>
): (call: PanelActionCall) => Promise<PluginHostCallOutcome> {
  const latest = useRef(props)
  latest.current = props
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const state = useCallback(
    () => ({
      presentation: latest.current.presentation ?? null,
      visible: latest.current.isVisible ?? true,
      height: Math.max(80, window.innerHeight - 80)
    }),
    []
  )
  useEffect(() => {
    const send = (): void => {
      pluginFrameWindowOf(frameRef.current)?.postMessage(
        pluginEvent(FRAME_EVENTS.push, {
          kind: 'message',
          event: 'workspace.presentation',
          payload: state()
        }),
        '*'
      )
    }
    send()
    window.addEventListener('resize', send)
    return () => window.removeEventListener('resize', send)
  }, [props.isVisible, props.presentation, frameRef, state])

  return useCallback(
    async (call) => {
      if (
        !latest.current.workspaceContext ||
        call.action !== 'plugin.request' ||
        !isPluginJsonObject(call.params)
      ) {
        return callPanelActionViaPreload(call)
      }
      const params = call.params
      const input = isPluginJsonObject(params.input) ? params.input : {}
      switch (params.name) {
        case 'workspace.presentation':
          return { ok: true, value: { output: state() } }
        case 'workspace.dismiss':
          setTimeout(() => latest.current.onDismiss?.(), 0)
          return { ok: true, value: { output: null } }
        case 'workspace.notice':
          if (typeof input.message === 'string' && input.message.length <= 1000)
            showError(input.message)
          return { ok: true, value: { output: null } }
        case 'workspace.height':
          if (
            typeof input.height === 'number' &&
            Number.isFinite(input.height) &&
            input.height >= 80 &&
            input.height <= 1200
          ) {
            latest.current.onContentHeight?.(Math.ceil(input.height))
          }
          return { ok: true, value: { output: null } }
        default:
          break
      }
      const outcome = await callPanelActionViaPreload({
        ...call,
        params: {
          ...params,
          input: {
            ...input,
            context: latest.current.workspaceContext ?? null,
            ...(latest.current.presentation ? { presentation: latest.current.presentation } : {})
          }
        }
      })
      if (
        !mounted.current &&
        !outcome.ok &&
        (input.action === 'start' || input.action === 'restart')
      ) {
        showError(outcome.error)
      }
      return outcome
    },
    [state]
  )
}
