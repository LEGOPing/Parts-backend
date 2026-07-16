//
//  DocumentPicker.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct DocumentPicker: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    @Binding var selectedFiles: [URL]
    var onImport: (([URL]) -> Void)?
    var isForSaving: Bool = false

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        if isForSaving {
            // 用于保存操作，使用更通用的配置
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.folder, .item],
                asCopy: false
            )
            picker.delegate = context.coordinator
            return picker
        } else {
            // 用于打开操作，选择文件
            let types: [UTType] = [.plainText, .commaSeparatedText, .item]
            
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: types,
                asCopy: true
            )
            picker.allowsMultipleSelection = true
            picker.delegate = context.coordinator
            return picker
        }
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: DocumentPicker

        init(_ parent: DocumentPicker) {
            self.parent = parent
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            parent.selectedFiles = urls
            parent.onImport?(urls)
            parent.isPresented = false
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.isPresented = false
        }
    }
}

struct DocumentPickerForSaving: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let suggestedFileName: String
    let onSave: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        // 使用更通用的方式创建文档选择器，支持访问云存储服务
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.item],
            asCopy: false
        )
        picker.delegate = context.coordinator
        // 启用文件夹选择
        if #available(iOS 14.0, *) {
            picker.allowsMultipleSelection = false
        }
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: DocumentPickerForSaving

        init(_ parent: DocumentPickerForSaving) {
            self.parent = parent
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            if let url = urls.first {
                // 确保URL是目录，然后创建完整的文件路径
                let directoryURL = url
                let fileURL = directoryURL.appendingPathComponent(parent.suggestedFileName)
                parent.onSave(fileURL)
            }
            parent.isPresented = false
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.isPresented = false
        }
    }
}
