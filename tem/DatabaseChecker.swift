//
//  DatabaseChecker.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/28.
//

import Foundation
import CoreData

class DatabaseChecker {
    
    static func checkSystemDatabaseStatus() {
        print("===== 检查系统数据库状态 =====")
        
        let persistence = PersistenceController.shared
        
        // 检查数据库URL
        if let databaseURL = persistence.getMainDatabaseURL() {
            print("系统数据库URL: \(databaseURL.path)")
            
            // 检查文件是否存在
            let fileManager = FileManager.default
            if fileManager.fileExists(atPath: databaseURL.path) {
                print("系统数据库文件存在")
                
                // 检查文件大小
                do {
                    let attributes = try fileManager.attributesOfItem(atPath: databaseURL.path)
                    if let fileSize = attributes[.size] as? Int64 {
                        print("系统数据库文件大小: \(fileSize) 字节")
                    }
                    if let modificationDate = attributes[.modificationDate] as? Date {
                        print("系统数据库文件修改时间: \(modificationDate)")
                    }
                } catch {
                    print("获取文件属性失败: \(error)")
                }
                
                // 检查数据库中的数据
                checkDatabaseContent()
            } else {
                print("系统数据库文件不存在: \(databaseURL.path)")
            }
        } else {
            print("无法获取系统数据库URL")
        }
        
        print("===== 检查完成 =====")
    }
    
    static func checkDatabaseContent() {
        print("检查数据库内容...")
        
        let persistence = PersistenceController.shared
        let context = persistence.container.viewContext
        
        // 检查仓库数量
        let repositoryFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Repository")
        do {
            let repositories = try context.fetch(repositoryFetchRequest)
            print("仓库数量: \(repositories.count)")
            
            for repository in repositories {
                if let name = repository.value(forKey: "name") as? String {
                    print("  仓库: \(name)")
                }
            }
        } catch {
            print("获取仓库失败: \(error)")
        }
        
        // 检查盒子数量
        let boxFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        do {
            let boxes = try context.fetch(boxFetchRequest)
            print("盒子数量: \(boxes.count)")
            
            for box in boxes {
                if let name = box.value(forKey: "name") as? String {
                    print("  盒子: \(name)")
                }
            }
        } catch {
            print("获取盒子失败: \(error)")
        }
        
        // 检查零件数量
        let partFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        do {
            let parts = try context.fetch(partFetchRequest)
            print("零件数量: \(parts.count)")
            
            // 打印前5个零件
            for part in parts.prefix(5) {
                if let partNum = part.value(forKey: "part_num") as? String {
                    print("  零件: \(partNum)")
                }
            }
        } catch {
            print("获取零件失败: \(error)")
        }
    }
    
    static func checkBackupProcess() {
        print("===== 检查备份过程 =====")
        
        // 创建临时备份URL
        let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        if let documentsDirectory = documentsDirectory {
            let backupDirectory = documentsDirectory.appendingPathComponent("Backups")
            let backupURL = backupDirectory.appendingPathComponent("SYS_PARTS_backup_test.sqlite")
            
            print("测试备份路径: \(backupURL.path)")
            
            // 执行备份
            let persistence = PersistenceController.shared
            do {
                try persistence.backupDatabase(to: backupURL, isRB: false)
                print("测试备份成功")
                
                // 检查备份文件
                let fileManager = FileManager.default
                if fileManager.fileExists(atPath: backupURL.path) {
                    print("备份文件存在")
                    
                    do {
                        let attributes = try fileManager.attributesOfItem(atPath: backupURL.path)
                        if let fileSize = attributes[.size] as? Int64 {
                            print("备份文件大小: \(fileSize) 字节")
                        }
                    } catch {
                        print("获取备份文件属性失败: \(error)")
                    }
                } else {
                    print("备份文件不存在")
                }
            } catch {
                print("测试备份失败: \(error)")
            }
        }
        
        print("===== 备份检查完成 =====")
    }
}