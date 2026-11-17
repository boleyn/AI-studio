//go:build darwin && !headless

#import <Cocoa/Cocoa.h>
#include <stdatomic.h>

static atomic_int windowPID = 0;
void connectorSetWindowPID(int pid) { atomic_store(&windowPID, pid); }

// Handle the button before menu tracking starts; never cancel a tracking menu
// from its notification callback, which can leave AppKit holding keyboard focus.
@interface ConnectorStatusAction : NSObject
@property(nonatomic, strong) NSStatusItem *item;
@property(nonatomic, strong) NSMenu *menu;
- (void)clicked:(id)sender;
@end
@implementation ConnectorStatusAction
- (void)clicked:(id)sender {
 int pid = atomic_load(&windowPID);
 NSRunningApplication *app = pid > 0 ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
 if (app != nil && NSApp.currentEvent.type != NSEventTypeRightMouseUp) {
  [app activateWithOptions:NSApplicationActivateAllWindows];
  [[NSDistributedNotificationCenter defaultCenter] postNotificationName:@"tech.asiainfo.connector.raise-window" object:[NSString stringWithFormat:@"%d", pid]];
  return;
 }
 [self.item popUpStatusItemMenu:self.menu];
}
@end
static ConnectorStatusAction *statusAction;
void connectorInstallStatusHook(void) {
 dispatch_async(dispatch_get_main_queue(), ^{
  @try {
   NSStatusItem *item = [(NSObject *)NSApp.delegate valueForKey:@"statusItem"];
   statusAction = [ConnectorStatusAction new];
   statusAction.item = item;
   statusAction.menu = item.menu;
   item.menu = nil;
   item.button.target = statusAction;
   item.button.action = @selector(clicked:);
   [item.button sendActionOn:NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp];
  } @catch (NSException *exception) {}
 });
}

void connectorSetStatus(int status) {
 dispatch_async(dispatch_get_main_queue(), ^{
  // getlantern/systray v1.2.2 exposes no attributed status title API.
  // Its AppDelegate owns this statusItem; keep the integration scoped here.
  @try {
   NSStatusItem *item = [(NSObject *)NSApp.delegate valueForKey:@"statusItem"];
   NSColor *color = status == 1 ? NSColor.systemGreenColor : status == 2 ? NSColor.systemOrangeColor : status == 3 ? NSColor.systemRedColor : NSColor.systemGrayColor;
   item.button.attributedTitle = [[NSAttributedString alloc] initWithString:@" ●" attributes:@{NSForegroundColorAttributeName:color, NSFontAttributeName:[NSFont systemFontOfSize:10 weight:NSFontWeightMedium]}];
   item.button.imagePosition = NSImageLeft;
  } @catch (NSException *exception) { /* Keep the standard tray functional if the dependency changes. */ }
 });
}
