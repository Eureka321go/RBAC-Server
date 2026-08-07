const { readFileSync } = require('fs');
const { resolve } = require('path');

describe('RayIM adaptive launcher icon', () => {
  it('keeps the foreground inside the Android adaptive-icon safe zone', () => {
    const drawable = readFileSync(
      resolve(__dirname, '../android/app/src/main/res/drawable/rayim_launcher_foreground.xml'),
      'utf8',
    );

    expect(drawable).toContain('android:inset="10dp"');
  });

  it('uses a light icon by day and the dark icon at night', () => {
    const dayIcon = readFileSync(
      resolve(__dirname, '../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),
      'utf8',
    );
    const nightIcon = readFileSync(
      resolve(__dirname, '../android/app/src/main/res/mipmap-night-anydpi-v26/ic_launcher.xml'),
      'utf8',
    );

    expect(dayIcon).toContain('@drawable/rayim_launcher_foreground_light');
    expect(nightIcon).toContain('@drawable/rayim_launcher_foreground');
  });
});
