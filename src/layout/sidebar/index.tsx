import { SidebarFooter } from "@layout/sidebar/Footer";
import { PresetSidebar } from "@layout/sidebar/preset/Sidebar";
import { useSidebar } from "@layout/sidebar/useSidebar";

function Sidebar() {
  const controls = useSidebar();
  return (
    <div class="size-full bg-transparent flex flex-col gap-1 pl2 pr0">
      <PresetSidebar controls={controls} />
      <SidebarFooter controls={controls} />
    </div>
  );
}

export default Sidebar;
