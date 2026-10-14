package com.mybangjo.merchant;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;

public class BluetoothThermalPrinter {
    // Standard SPP (Serial Port Profile) UUID for Bluetooth thermal printers
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothSocket socket;
    private OutputStream outputStream;
    private String connectedAddress;

    public String getPairedDevicesJson() {
        JSONArray list = new JSONArray();
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter != null && adapter.isEnabled()) {
                Set<BluetoothDevice> paired = adapter.getBondedDevices();
                if (paired != null) {
                    for (BluetoothDevice dev : paired) {
                        JSONObject obj = new JSONObject();
                        obj.put("name", dev.getName() != null ? dev.getName() : "Printer Bluetooth");
                        obj.put("address", dev.getAddress());
                        list.put(obj);
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return list.toString();
    }

    public synchronized boolean connect(String address) {
        if (address == null || address.trim().isEmpty()) return false;
        if (isConnected() && address.equalsIgnoreCase(connectedAddress)) {
            return true;
        }

        disconnect();

        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) return false;

            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device == null) return false;

            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            adapter.cancelDiscovery();
            socket.connect();
            outputStream = socket.getOutputStream();
            connectedAddress = address;
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            disconnect();
            return false;
        }
    }

    public synchronized boolean isConnected() {
        return socket != null && socket.isConnected() && outputStream != null;
    }

    public synchronized void disconnect() {
        try {
            if (outputStream != null) {
                outputStream.close();
                outputStream = null;
            }
            if (socket != null) {
                socket.close();
                socket = null;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        connectedAddress = null;
    }

    public synchronized boolean printRawBytes(byte[] bytes) {
        if (!isConnected() || outputStream == null) return false;
        try {
            outputStream.write(bytes);
            outputStream.flush();
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            disconnect();
            return false;
        }
    }

    public synchronized boolean printBase64(String base64Data) {
        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            return printRawBytes(bytes);
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    public synchronized boolean printFormattedReceipt(String text) {
        try {
            // ESC @ (Initialize printer)
            byte[] init = new byte[]{0x1B, 0x40};
            // ESC t 0 (Character code page: PC437 / Standard)
            byte[] codePage = new byte[]{0x1B, 0x74, 0x00};
            byte[] content = text.getBytes(Charset.forName("CP437"));
            // 4 Line feeds + Partial paper cut (GS V 66 0)
            byte[] cut = new byte[]{0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00};

            byte[] full = new byte[init.length + codePage.length + content.length + cut.length];
            System.arraycopy(init, 0, full, 0, init.length);
            System.arraycopy(codePage, 0, full, init.length, codePage.length);
            System.arraycopy(content, 0, full, init.length + codePage.length, content.length);
            System.arraycopy(cut, 0, full, init.length + codePage.length + content.length, cut.length);

            return printRawBytes(full);
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }
}
