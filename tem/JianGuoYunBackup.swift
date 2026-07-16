//
//  JianGuoYunBackup.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/26.
//

import SwiftUI
import UIKit

class JianGuoYunBackup {
    enum DatabaseType {
        case system
        case rb
    }
    // 备份到坚果云
    static func backupToJianGuoYun(databaseType: DatabaseType) {
        print("===== 开始备份到坚果云 =====")
        
        // 显示备份开始提示
        DispatchQueue.main.async {
            let alert = UIAlertController(title: "备份开始", message: "正在备份数据库到坚果云，请稍候...", preferredStyle: .alert)
            
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(alert, animated: true) {
                    // 延迟一秒后关闭提示，开始执行备份
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        alert.dismiss(animated: true) {
                            // 在后台线程执行备份操作
                            self.performBackupToJianGuoYun(databaseType: databaseType)
                        }
                    }
                }
            }
        }
    }
    
    // 执行备份到坚果云的操作
    private static func performBackupToJianGuoYun(databaseType: DatabaseType) {
        print("执行备份到坚果云的操作")
        
        // 备份指定类型的数据库
        var filesToUpload: [URL] = []
        
        switch databaseType {
        case .system:
            // 备份系统数据库
            let sysBackupURL = createBackupFileURL(isRB: false)
            if let sysURL = sysBackupURL {
                do {
                    try PersistenceController.shared.backupDatabase(to: sysURL, isRB: false)
                    print("系统数据库备份路径: \(sysURL.path)")
                    filesToUpload.append(sysURL)
                } catch {
                    print("系统数据库备份失败: \(error)")
                }
            }
        case .rb:
            // 备份RB数据库
            let rbBackupURL = createBackupFileURL(isRB: true)
            if let rbURL = rbBackupURL {
                do {
                    try PersistenceController.shared.backupDatabase(to: rbURL, isRB: true)
                    print("RB数据库备份路径: \(rbURL.path)")
                    filesToUpload.append(rbURL)
                } catch {
                    print("RB数据库备份失败: \(error)")
                }
            }
        }
        
        // 3. 上传备份文件到坚果云
        
        if filesToUpload.isEmpty {
            print("没有备份文件需要上传")
            
            // 显示备份失败提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "备份失败", message: "无法创建备份文件", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
            
            return
        }
        
        print("准备上传 \(filesToUpload.count) 个文件到坚果云")
        
        // 上传文件到坚果云
        uploadFilesToJianGuoYun(filesToUpload) {
            // 备份完成，显示成功提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "备份成功", message: "数据库已成功备份到坚果云", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
        } onError: {
            // 备份失败，显示错误提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "备份失败", message: "上传到坚果云失败", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
        }
    }
    
    // 上传文件到坚果云
    static func uploadFilesToJianGuoYun(_ files: [URL], onSuccess: @escaping () -> Void, onError: @escaping () -> Void) {
        print("开始上传文件到坚果云: \(files.count) 个文件")
        
        let serverURL = "https://dav.jianguoyun.com/dav/"
        let username = "2662029665@qq.com"
        let password = "az8tiiv5bgauidsq"
        let folderPath = "SDLEGO_Parts"
        
        // 创建文件夹路径
        let fullFolderPath = serverURL + folderPath
        print("坚果云文件夹路径: \(fullFolderPath)")
        
        // 为每个文件创建上传任务
        let dispatchGroup = DispatchGroup()
        var uploadErrors = 0
        
        for fileURL in files {
            dispatchGroup.enter()
            
            let fileName = fileURL.lastPathComponent
            let fullFilePath = fullFolderPath + "/" + fileName
            print("上传文件: \(fileName) 到 \(fullFilePath)")
            
            // 创建URLRequest
            guard let url = URL(string: fullFilePath) else {
                print("无效的文件URL")
                uploadErrors += 1
                dispatchGroup.leave()
                continue
            }
            
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            
            // 添加认证头
            let credentials = "\(username):\(password)"
            if let encodedCredentials = credentials.data(using: .utf8) {
                let base64Credentials = encodedCredentials.base64EncodedString()
                request.setValue("Basic \(base64Credentials)", forHTTPHeaderField: "Authorization")
            }
            
            // 添加Content-Type头
            let mimeType = "application/octet-stream"
            request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
            
            // 读取文件数据
            do {
                let fileData = try Data(contentsOf: fileURL)
                request.httpBody = fileData
                
                // 添加Content-Length头
                request.setValue("\(fileData.count)", forHTTPHeaderField: "Content-Length")
                
                // 执行上传任务
                let task = URLSession.shared.dataTask(with: request) { data, response, error in
                    defer { dispatchGroup.leave() }
                    
                    if let error = error {
                        print("上传文件 \(fileName) 失败: \(error)")
                        uploadErrors += 1
                        return
                    }
                    
                    guard let httpResponse = response as? HTTPURLResponse else {
                        print("上传文件 \(fileName) 失败: 无效的响应")
                        uploadErrors += 1
                        return
                    }
                    
                    if (200...299).contains(httpResponse.statusCode) {
                        print("上传文件 \(fileName) 成功，状态码: \(httpResponse.statusCode)")
                    } else {
                        print("上传文件 \(fileName) 失败，状态码: \(httpResponse.statusCode)")
                        uploadErrors += 1
                    }
                }
                
                task.resume()
                
            } catch {
                print("读取文件 \(fileName) 失败: \(error)")
                uploadErrors += 1
                dispatchGroup.leave()
            }
        }
        
        // 等待所有上传任务完成
        dispatchGroup.notify(queue: .main) {
            if uploadErrors == 0 {
                print("所有文件上传成功")
                onSuccess()
            } else {
                print("\(uploadErrors) 个文件上传失败")
                onError()
            }
        }
    }
    
    // 创建备份文件URL
    private static func createBackupFileURL(isRB: Bool) -> URL? {
        let fileManager = FileManager.default
        let documentsDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first
        guard let documentsDirectory = documentsDirectory else { return nil }
        
        // 创建备份目录
        let backupDirectory = documentsDirectory.appendingPathComponent("Backups")
        do {
            if !fileManager.fileExists(atPath: backupDirectory.path) {
                try fileManager.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
            }
        } catch {
            print("创建备份目录失败: \(error)")
            return nil
        }
        
        // 生成时间戳
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyyMMdd_HHmmss"
        let timestamp = dateFormatter.string(from: Date())
        
        // 生成文件名
        let fileName = isRB ? "RB_backup_\(timestamp).sqlite" : "SYS_PARTS_backup_\(timestamp).sqlite"
        return backupDirectory.appendingPathComponent(fileName)
    }
    
    // 本地备份数据库
    static func backupToLocal(databaseType: DatabaseType) {
        print("===== 开始本地备份数据库 =====")
        
        // 显示备份开始提示
        DispatchQueue.main.async {
            let alert = UIAlertController(title: "备份开始", message: "正在备份数据库到本地，请稍候...", preferredStyle: .alert)
            
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(alert, animated: true) {
                    // 延迟一秒后关闭提示，开始执行备份
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        alert.dismiss(animated: true) {
                            // 在后台线程执行备份操作
                            self.performLocalBackup(databaseType: databaseType) { _ in
                                // 备份完成后不需要额外操作
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 执行本地备份操作（带回调）
    static func performLocalBackup(databaseType: DatabaseType, completion: @escaping (Bool) -> Void) {
        print("执行本地备份操作")
        
        var backupURL: URL?
        var backupSuccess = false
        var backupPath = ""
        
        switch databaseType {
        case .system:
            // 备份系统数据库
            backupURL = createBackupFileURL(isRB: false)
            if let url = backupURL {
                do {
                    try PersistenceController.shared.backupDatabase(to: url, isRB: false)
                    print("系统数据库本地备份路径: \(url.path)")
                    backupSuccess = true
                    backupPath = url.path
                } catch {
                    print("系统数据库本地备份失败: \(error)")
                }
            }
        case .rb:
            // 备份RB数据库
            backupURL = createBackupFileURL(isRB: true)
            if let url = backupURL {
                do {
                    try PersistenceController.shared.backupDatabase(to: url, isRB: true)
                    print("RB数据库本地备份路径: \(url.path)")
                    backupSuccess = true
                    backupPath = url.path
                } catch {
                    print("RB数据库本地备份失败: \(error)")
                }
            }
        }
        
        // 显示备份结果提示
        DispatchQueue.main.async {
            if backupSuccess {
                let alert = UIAlertController(title: "备份成功", message: "数据库已成功备份到本地\n路径: \(backupPath)", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
                    completion(backupSuccess)
                })
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            } else {
                let alert = UIAlertController(title: "备份失败", message: "数据库本地备份失败", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
                    completion(backupSuccess)
                })
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
        }
    }
    
    // 执行本地备份操作（不带回调，内部使用）
    private static func performLocalBackup(databaseType: DatabaseType) {
        performLocalBackup(databaseType: databaseType) { _ in
            // 不需要额外操作
        }
    }
    
    // 上传选择的文件到坚果云
    static func uploadSelectedFilesToJianGuoYun(_ urls: [URL]) {
        print("===== 开始上传选择的文件到坚果云 =====")
        print("选择了 \(urls.count) 个文件")
        
        if urls.isEmpty {
            print("没有选择文件")
            
            // 显示提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "提示", message: "请选择要上传的文件", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
            
            return
        }
        
        // 显示上传开始提示
        DispatchQueue.main.async {
            let alert = UIAlertController(title: "上传开始", message: "正在上传文件到坚果云，请稍候...", preferredStyle: .alert)
            
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(alert, animated: true) {
                    // 延迟一秒后关闭提示，开始执行上传
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        alert.dismiss(animated: true) {
                            // 执行上传操作
                            self.uploadFilesToJianGuoYun(urls) {
                                // 上传成功，显示提示
                                DispatchQueue.main.async {
                                    let successAlert = UIAlertController(title: "上传成功", message: "文件已成功上传到坚果云", preferredStyle: .alert)
                                    successAlert.addAction(UIAlertAction(title: "确定", style: .default))
                                    
                                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                                       let rootViewController = windowScene.windows.first?.rootViewController {
                                        rootViewController.present(successAlert, animated: true)
                                    }
                                }
                            } onError: {
                                // 上传失败，显示提示
                                DispatchQueue.main.async {
                                    let errorAlert = UIAlertController(title: "上传失败", message: "文件上传到坚果云失败", preferredStyle: .alert)
                                    errorAlert.addAction(UIAlertAction(title: "确定", style: .default))
                                    
                                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                                       let rootViewController = windowScene.windows.first?.rootViewController {
                                        rootViewController.present(errorAlert, animated: true)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 恢复数据库
    static func restoreDatabase(from urls: [URL], databaseType: DatabaseType) {
        print("===== 开始恢复数据库 =====")
        
        if urls.isEmpty {
            print("没有选择文件")
            
            // 显示提示
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "提示", message: "请选择要恢复的备份文件", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
            
            return
        }
        
        // 显示恢复开始提示
        DispatchQueue.main.async {
            let alert = UIAlertController(title: "恢复开始", message: "正在恢复数据库，请稍候...", preferredStyle: .alert)
            
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootViewController = windowScene.windows.first?.rootViewController {
                rootViewController.present(alert, animated: true) {
                    // 延迟一秒后关闭提示，开始执行恢复
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        alert.dismiss(animated: true) {
                            // 在后台线程执行恢复操作
                            self.performRestore(from: urls.first!, databaseType: databaseType)
                        }
                    }
                }
            }
        }
    }
    
    // 执行恢复操作
    private static func performRestore(from url: URL, databaseType: DatabaseType) {
        print("执行恢复数据库操作")
        print("恢复文件路径: \(url.path)")
        
        var restoreSuccess = false
        
        do {
            try PersistenceController.shared.restoreDatabase(from: url, isRB: databaseType == .rb)
            print("数据库恢复成功")
            restoreSuccess = true
        } catch {
            print("数据库恢复失败: \(error)")
        }
        
        // 显示恢复结果提示
        DispatchQueue.main.async {
            if restoreSuccess {
                let alert = UIAlertController(title: "恢复成功", message: "数据库已成功恢复", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            } else {
                let alert = UIAlertController(title: "恢复失败", message: "数据库恢复失败", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "确定", style: .default))
                
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootViewController = windowScene.windows.first?.rootViewController {
                    rootViewController.present(alert, animated: true)
                }
            }
        }
    }
}
