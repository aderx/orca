import { Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import logo from '../../../../../resources/logo.svg'

export function WorkspaceEmptyState({
  onNewTerminal
}: {
  onNewTerminal: () => void
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-auto bg-background p-6">
      <div className="flex flex-col items-center gap-5 py-8">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-foreground shadow-xs">
          <img src={logo} alt="Orca" className="size-12 dark:invert" />
        </div>
        <h2 className="text-4xl font-bold tracking-tight text-foreground">orca zstack</h2>
        <Button variant="outline" onClick={onNewTerminal}>
          <Terminal />
          {translate('auto.components.tab.bar.TabBar.d364f3c8d4', 'New Terminal')}
        </Button>
      </div>
    </div>
  )
}
