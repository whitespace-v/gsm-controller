#!/usr/bin/bash

PORT="$1"

SYSFS_PATH=$(readlink -f /sys/class/tty/$PORT/device/../..)
USB_DEVICE=$(basename "$SYSFS_PATH")

echo "Resetting USB device for /dev/$PORT -> $USB_DEVICE"

echo 0 | sudo tee /sys/bus/usb/devices/$USB_DEVICE/authorized
sleep 1
echo 1 | sudo tee /sys/bus/usb/devices/$USB_DEVICE/authorized


# for i in /sys/bus/pci/drivers/[uoex]hci_hcd/*:*; do
#   echo "${i##*/}" > "${i%/*}/unbind"
#   echo "${i##*/}" > "${i%/*}/bind"
# done

# echo 0 | sudo tee /sys/bus/usb/devices/1-1/authorized
# sleep 1
# echo 1 | sudo tee /sys/bus/usb/devices/1-1/authorized
