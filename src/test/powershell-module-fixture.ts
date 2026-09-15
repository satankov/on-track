import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Reproduce module-name collisions inherited by a Windows PowerShell grandchild. */
export function conflictingPowerShellModulePath(root: string): string {
  const modules = join(root, "incompatible modules");
  for (const [name, command] of [
    ["Microsoft.PowerShell.Utility", "Get-FileHash"],
    ["Microsoft.PowerShell.Security", "Get-Acl"],
  ]) {
    const directory = join(modules, name, "99.0.0");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "poison.psm1"),
      "throw 'Incompatible module was loaded'\n",
    );
    writeFileSync(
      join(directory, `${name}.psd1`),
      `@{ RootModule = 'poison.psm1'; ModuleVersion = '99.0.0'; FunctionsToExport = @('${command}') }\n`,
    );
  }
  return [modules, process.env.PSModulePath].filter(Boolean).join(";");
}
