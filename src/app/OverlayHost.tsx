import { ContextDrawer } from './Drawer';
import { ChaosDialog, CommandPalette } from './Overlays';
import { AddBackendWizard, ExportWizard, OverrideWizard } from './Wizards';

/** Everything that opens on demand. Loaded the first time any of it is requested. */
export default function OverlayHost() {
  return (
    <>
      <ContextDrawer />
      <CommandPalette />
      <ChaosDialog />
      <AddBackendWizard />
      <OverrideWizard />
      <ExportWizard />
    </>
  );
}
