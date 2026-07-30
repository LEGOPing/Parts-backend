//
//  SystemDatabaseView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/15.
//

import SwiftUI
import CoreData
import Foundation

struct SystemDatabaseView: View {
    @State private var databaseTables: [String] = []
    @State private var selectedTable: String? = nil
    @State private var tableData: [NSManagedObject] = []
    @State private var isLoading = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // 顶部导航栏
                HStack {
                    Spacer()
                    
                    Text("系统主数据库结构")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.primary)
                    
                    Spacer()
                    
                    Button(action: {
                        selectedTable = nil
                        tableData = []
                    }) {
                        Text("返回")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.blue)
                    }
                    .padding(.trailing, 16)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.white)
                .shadow(color: .gray.opacity(0.2), radius: 3, x: 0, y: 1)
                
                // 主内容区域
                VStack(spacing: 16) {
                    // 上部：水平滚动的表卡片
                    VStack(alignment: .leading, spacing: 8) {
                        Text("数据库表")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                            .padding(.leading, 16)
                            .padding(.top, 8)
                        
                        if isLoading {
                            HStack {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .blue))
                                    .scaleEffect(1.0)
                                Text("正在加载数据库表...")
                                    .foregroundColor(.gray)
                            }
                            .padding(.leading, 16)
                            .padding(.vertical, 20)
                        } else {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    if databaseTables.isEmpty {
                                        Text("未找到数据库表")
                                            .font(.system(size: 14))
                                            .foregroundColor(.gray)
                                            .padding(.leading, 16)
                                    } else {
                                        ForEach(databaseTables, id: \.self) { table in
                                            TableCard(tableName: table, isSelected: selectedTable == table) {
                                                selectedTable = table
                                                loadTableData(tableName: table)
                                            }
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                            }
                        }
                    }
                    
                    // 下部：表的数据
                    if let selectedTable = selectedTable {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("表: \(selectedTable)")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.primary)
                                .padding(.leading, 16)
                            
                            if tableData.isEmpty {
                                EmptyStateView(
                                    title: "暂无数据",
                                    message: "该表中没有数据记录",
                                    primaryAction: {},
                                    primaryActionTitle: ""
                                )
                                .padding()
                            } else {
                                ScrollView(.vertical) {
                                    ScrollView(.horizontal) {
                                        VStack(spacing: 0) {
                                            // 表头
                                            if let firstObject = tableData.first {
                                                TableHeaderView(object: firstObject)
                                            }
                                            
                                            // 数据行
                                            ForEach(tableData, id: \.objectID) { object in
                                                TableRowView(object: object)
                                            }
                                        }
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 4)
                                    }
                                }
                            }
                        }
                        .frame(maxHeight: .infinity)
                    } else {
                        EmptyStateView(
                            title: "欢迎使用系统数据库管理",
                            message: "请选择一个数据库表来查看其结构和数据",
                            primaryAction: {},
                            primaryActionTitle: ""
                        )
                        .frame(maxHeight: .infinity)
                    }
                }
            }
            .background(Color(.systemGray6))
        }
        .onAppear {
            loadDatabaseTables()
        }
    }
    
    // 加载数据库中的所有表名
    func loadDatabaseTables() {
        isLoading = true
        
        // 在后台线程上执行，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            let systemContext = PersistenceController.shared.container.viewContext
            
            var tables: [String] = []
            
            // 获取持久化存储协调器
            if let persistentStoreCoordinator = systemContext.persistentStoreCoordinator {
                // 获取所有持久化存储
                for store in persistentStoreCoordinator.persistentStores {
                    if let storeURL = store.url {
                        // 从存储中获取表名
                        let storeMetadata = persistentStoreCoordinator.metadata(for: store)
                        let model = NSManagedObjectModel(contentsOf: storeMetadata[NSStoreModelVersionIdentifiersKey] as? URL ?? storeURL) ?? PersistenceController.shared.container.managedObjectModel
                        
                        // 从模型中获取所有实体名称
                        for entity in model.entities {
                            if let entityName = entity.name {
                                tables.append(entityName)
                            }
                        }
                    }
                }
            }
            
            // 如果模型中没有实体，尝试一些常见的表名
            if tables.isEmpty {
                tables = ["Repository", "Box", "Part", "Category"]
                print("模型中没有实体，使用常见表名列表")
            }
            
            // 去重并排序
            tables = Array(Set(tables)).sorted()
            
            print("系统数据库表列表: \(tables)")
            
            // 在主线程上更新UI
            DispatchQueue.main.async {
                self.databaseTables = tables
                self.isLoading = false
            }
        }
    }
    
    // 加载所选表的前10条数据
    func loadTableData(tableName: String) {
        isLoading = true
        
        // 在后台线程上执行，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            let systemContext = PersistenceController.shared.container.viewContext
            
            var data: [NSManagedObject] = []
            
            // 检查实体是否存在
            if NSEntityDescription.entity(forEntityName: tableName, in: systemContext) != nil {
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: tableName)
                fetchRequest.fetchLimit = 10 // 只显示前10条数据
                
                do {
                    data = try systemContext.fetch(fetchRequest)
                    print("成功加载\(tableName)表数据，共\(data.count)条")
                } catch {
                    print("加载\(tableName)表失败: \(error)")
                }
            } else {
                print("实体\(tableName)不存在")
            }
            
            // 在主线程上更新UI
            DispatchQueue.main.async {
                self.tableData = data
                self.isLoading = false
            }
        }
    }
}



// 表卡片组件
struct TableCard: View {
    let tableName: String
    let isSelected: Bool
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            VStack {
                Image(systemName: "table")
                    .foregroundColor(isSelected ? .white : .blue)
                    .font(.system(size: 24))
                    .padding(16)
                Text(tableName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(isSelected ? .white : .primary)
                    .padding(.bottom, 16)
            }
            .frame(width: 120, height: 100)
            .background(isSelected ? Color.blue : Color.white)
            .cornerRadius(12)
            .shadow(color: isSelected ? .blue.opacity(0.3) : .gray.opacity(0.2), radius: 4, x: 0, y: 2)
            .transition(.scale)
        }
    }
}

// 表格头视图
struct TableHeaderView: View {
    let object: NSManagedObject
    
    private var allKeys: [String] {
        // 先添加 ID 列
        var keys = ["id"]
        // 再添加所有属性
        keys.append(contentsOf: Array(object.entity.attributesByName.keys).sorted())
        // 如果有 box 关系，添加 boxID 列
        if object.entity.relationshipsByName.keys.contains("box") {
            keys.append("boxID")
        }
        return keys
    }
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(allKeys, id: \.self) { key in
                Text(key)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                    .padding(4)
                    .background(Color.blue)
                    .cornerRadius(2)
                    .frame(width: key == "img_url" ? 300 : 100, alignment: .leading)
            }
        }
    }
}

// 表格行视图
struct TableRowView: View {
    let object: NSManagedObject
    
    private var allKeys: [String] {
        // 先添加 ID 列
        var keys = ["id"]
        // 再添加所有属性
        keys.append(contentsOf: Array(object.entity.attributesByName.keys).sorted())
        // 如果有 box 关系，添加 boxID 列
        if object.entity.relationshipsByName.keys.contains("box") {
            keys.append("boxID")
        }
        return keys
    }
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(allKeys, id: \.self) { key in
                if key == "id" {
                    // 显示 objectID
                    Text(object.objectID.uriRepresentation().lastPathComponent)
                        .font(.system(size: 12))
                        .foregroundColor(.primary)
                        .padding(4)
                        .background(Color.white)
                        .cornerRadius(2)
                        .shadow(color: .gray.opacity(0.1), radius: 1, x: 0, y: 1)
                        .frame(width: 100, alignment: .leading)
                } else if key == "boxID" {
                    // 显示 box 关系的 ID
                    if let box = object.value(forKey: "box") as? NSManagedObject {
                        Text(box.objectID.uriRepresentation().lastPathComponent)
                            .font(.system(size: 12))
                            .foregroundColor(.primary)
                            .padding(4)
                            .background(Color.white)
                            .cornerRadius(2)
                            .shadow(color: .gray.opacity(0.1), radius: 1, x: 0, y: 1)
                            .frame(width: 100, alignment: .leading)
                    } else {
                        Text("nil")
                            .font(.system(size: 12))
                            .foregroundColor(.primary)
                            .padding(4)
                            .background(Color.white)
                            .cornerRadius(2)
                            .shadow(color: .gray.opacity(0.1), radius: 1, x: 0, y: 1)
                            .frame(width: 100, alignment: .leading)
                    }
                } else {
                    // 显示普通属性
                    Text(object.value(forKey: key) != nil ? String(describing: object.value(forKey: key)!) : "nil")
                        .font(.system(size: 12))
                        .foregroundColor(.primary)
                        .padding(4)
                        .background(Color.white)
                        .cornerRadius(2)
                        .shadow(color: .gray.opacity(0.1), radius: 1, x: 0, y: 1)
                        .frame(width: key == "img_url" ? 300 : 100, alignment: .leading)
                }
            }
        }
    }
}

// 表单元格组件
struct TableCell: View {
    let tableName: String
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack {
                Image(systemName: "table")
                    .foregroundColor(.blue)
                    .font(.system(size: 18))
                Text(tableName)
                    .font(.system(size: 16))
                    .foregroundColor(.primary)
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(.gray)
                    .font(.system(size: 14))
            }
            .padding()
            .background(Color.white)
            .cornerRadius(10)
            .shadow(color: .gray.opacity(0.1), radius: 2, x: 0, y: 1)
            .transition(.slide)
        }
    }
}



// 数据行视图
struct DataRowView: View {
    let object: NSManagedObject
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 创建稳定的属性键数组，避免在渲染过程中集合被修改
            let attributeKeys = Array(object.entity.attributesByName.keys).sorted()
            
            ForEach(attributeKeys, id: \.self) { key in
                HStack(spacing: 8) {
                    Text(key)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.secondary)
                        .frame(width: 100, alignment: .leading)
                    
                    if let value = object.value(forKey: key) {
                        Text(String(describing: value))
                            .font(.system(size: 13))
                            .foregroundColor(.primary)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("nil")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)
                            .italic()
                    }
                }
            }
        }
        .padding(8)
        .background(Color.white)
        .cornerRadius(8)
        .shadow(color: .gray.opacity(0.1), radius: 1, x: 0, y: 1)
    }
}

// 空状态视图
struct EmptyStateView: View {
    let title: String
    let message: String
    let primaryAction: () -> Void
    let primaryActionTitle: String
    let secondaryAction: (() -> Void)? = nil
    let secondaryActionTitle: String? = nil
    
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "database")
                .font(.system(size: 64))
                .foregroundColor(.gray.opacity(0.5))
            
            Text(title)
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.primary)
            
            Text(message)
                .font(.system(size: 14))
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            
            VStack(spacing: 12) {
                Button(action: primaryAction) {
                    Text(primaryActionTitle)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(
                            LinearGradient(gradient: Gradient(colors: [Color.blue, Color.cyan]), startPoint: .leading, endPoint: .trailing)
                        )
                        .cornerRadius(8)
                        .shadow(color: .blue.opacity(0.3), radius: 4, x: 0, y: 2)
                }
                
                if let secondaryAction = secondaryAction, let secondaryActionTitle = secondaryActionTitle {
                    Button(action: secondaryAction) {
                        Text(secondaryActionTitle)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.blue)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(Color.blue.opacity(0.1))
                            .cornerRadius(8)
                    }
                }
            }
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}