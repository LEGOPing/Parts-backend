//
//  RBDatabaseView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

struct RBDatabaseView: View {
    @Binding var importedData: [String]
    
    // 表选择相关状态
    @State private var databaseTables: [String] = []
    @State private var selectedTable: String? = nil
    @State private var tableData: [NSManagedObject] = []
    @State private var showTableSelector = true
    
    var body: some View {
        NavigationView {
            VStack {
                Text("RB数据库结构")
                    .font(.system(size: 24, weight: .bold))
                    .padding()
                
                // 表选择器（放在顶部，使用卡片网格）
                if showTableSelector {
                    VStack {
                        Text("选择要查看的表")
                            .font(.system(size: 18, weight: .bold))
                            .padding()
                        
                        ScrollView {
                            if databaseTables.isEmpty {
                                Text("正在加载数据库表...")
                                    .foregroundColor(.gray)
                                    .padding()
                            } else {
                                // 使用网格布局，每行4个卡片，完全统一大小
                                LazyVGrid(columns: [
                                    GridItem(.fixed(100), spacing: 12),
                                    GridItem(.fixed(100), spacing: 12),
                                    GridItem(.fixed(100), spacing: 12),
                                    GridItem(.fixed(100), spacing: 12)
                                ], spacing: 12) {
                                    ForEach(databaseTables, id: \.self) {
                                        table in
                                        Button(action: {
                                            selectedTable = table
                                            loadTableData(tableName: table)
                                            showTableSelector = false
                                        }) {
                                            // 卡片样式，完全统一大小
                                            VStack {
                                                Text(table)
                                                    .font(.system(size: 14, weight: .medium))
                                                    .foregroundColor(.blue)
                                                    .multilineTextAlignment(.center)
                                                    .padding(12)
                                            }
                                            .frame(width: 100, height: 90)
                                            .background(Color.blue.opacity(0.1))
                                            .cornerRadius(12)
                                            .border(Color.blue.opacity(0.3), width: 1)
                                            .shadow(color: Color.gray.opacity(0.2), radius: 2, x: 0, y: 2)
                                        }
                                    }
                                }
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                        .frame(minHeight: 200, maxHeight: 300)
                        
                        Button(action: {
                            showTableSelector = false
                        }) {
                            Text("取消")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 32)
                                .padding(.vertical, 12)
                                .background(Color.gray)
                                .cornerRadius(8)
                        }
                        .padding()
                    }
                } else if let selectedTable = selectedTable {
                    // 显示所选表的数据（放在下面）
                    VStack {
                        HStack {
                            Text("表: \(selectedTable)")
                                .font(.system(size: 18, weight: .bold))
                            
                            Spacer()
                            
                            Button(action: {
                                showTableSelector = true
                                self.selectedTable = nil
                                tableData = []
                            }) {
                                Text("重新选择")
                                    .font(.system(size: 14))
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        
                        // 分页信息显示
                        HStack {
                            Text("显示 \(tableData.count)/\(totalCount) 条数据")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)
                            Spacer()
                            Text("每页 \(pageSize) 条")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)
                        }
                        .padding(.horizontal)
                        
                        // 表数据显示（使用紧凑表格形式，支持垂直和水平滚动，左对齐，上对齐）
                        ScrollView([.vertical, .horizontal]) {
                            if tableData.isEmpty {
                                Text("暂无数据")
                                    .foregroundColor(.gray)
                                    .padding()
                                    .multilineTextAlignment(.leading)
                            } else if let firstObject = tableData.first {
                                // 获取所有属性名作为表头，按指定顺序排列
                                let attributesKeys = Array(firstObject.entity.attributesByName.keys)
                                let attributeNames = getFieldOrder(for: selectedTable).filter { 
                                    attributesKeys.contains($0) 
                                }
                                
                                // 如果没有按指定顺序的字段，使用默认顺序
                                let displayAttributeNames = attributeNames.isEmpty ? 
                                    attributesKeys : attributeNames
                                
                                VStack(spacing: 0) {
                                    // 表头（固定宽度，无间距，无边框，左对齐，上对齐）
                                    HStack(alignment: .top, spacing: 0) {
                                        ForEach(displayAttributeNames, id: \.self) {
                                            attributeName in
                                            VStack(alignment: .leading, spacing: 0) {
                                                Text(attributeName)
                                                    .font(.system(size: 12, weight: .bold))
                                                    .padding(6)
                                                    .background(Color.blue.opacity(0.1))
                                                    .multilineTextAlignment(.leading)
                                            }
                                            .frame(width: 120, alignment: .topLeading)
                                        }
                                    }
                                    
                                    // 数据行（固定宽度，无间距，无边框，左对齐，上对齐）
                                    ForEach(tableData, id: \.objectID) { object in
                                        HStack(alignment: .top, spacing: 0) {
                                            ForEach(displayAttributeNames, id: \.self) {
                                                attributeName in
                                                VStack(alignment: .leading, spacing: 0) {
                                                    let value = object.value(forKey: attributeName)
                                                    Text(value != nil ? String(describing: value!) : "nil")
                                                        .font(.system(size: 12))
                                                        .padding(6)
                                                        .multilineTextAlignment(.leading)
                                                        .lineLimit(nil) // 允许自动换行
                                                        .environment(\.layoutDirection, .leftToRight)
                                                }
                                                .frame(width: 120, alignment: .topLeading)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        .frame(minHeight: 300, maxHeight: 500)
                        
                        // 加载更多按钮
                        if hasMoreData {
                            Button(action: {
                                loadMoreData()
                            }) {
                                Text("加载更多数据")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 10)
                                    .background(Color.blue)
                                    .cornerRadius(6)
                            }
                            .padding()
                        } else if tableData.count > 0 {
                            Text("已加载全部数据")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)
                                .padding()
                        }
                    }
                } else {
                    // 默认显示表选择器
                    VStack {
                        Text("请选择要查看的表")
                            .font(.system(size: 18, weight: .bold))
                            .padding()
                        
                        Button(action: {
                            showTableSelector = true
                        }) {
                            Text("选择表")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 32)
                                .padding(.vertical, 12)
                                .background(Color.blue)
                                .cornerRadius(8)
                        }
                        .padding()
                    }
                }
            }
            .onAppear {
                loadDatabaseTables()
            }
        }
    }
    
    // 获取指定表的字段顺序
    func getFieldOrder(for tableName: String) -> [String] {
        switch tableName {
        case "Inventory_parts":
            return ["inventory_id", "part_num", "color_id", "quantity", "is_spare", "img_url"]
        case "Parts_categories":
            return ["id", "name"]
        case "Part_relationships":
            return ["rel_type", "child_part_num", "parent_part_num"]
        case "Parts":
            return ["part_num", "name", "part_cat_id", "part_material"]
        case "Colors":
            return ["id", "name", "rgb", "is_trans", "num_parts", "num_sets", "y1", "y2"]
        case "Elements":
            return ["element_id", "part_num", "color_id", "design_id"]
        default:
            return Array(tableName == "Inventory_parts" ? ["inventory_id", "part_num", "color_id", "quantity", "is_spare", "img_url"] : [])
        }
    }
    
    // 动态显示对象的所有属性
    func displayObjectProperties(_ object: NSManagedObject) -> some View {
        // 创建稳定的属性键数组，避免在渲染过程中集合被修改
        let attributeKeys = Array(object.entity.attributesByName.keys)
        
        return VStack(alignment: .leading, spacing: 4) {
            ForEach(attributeKeys, id: \.self) { key in
                if let value = object.value(forKey: key) {
                    Text("\(key): \(String(describing: value))")
                } else {
                    Text("\(key): nil")
                }
            }
        }
    }
    
    // 加载数据库中的所有表名
    func loadDatabaseTables() {
        // 在后台线程上执行，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            var tables: [String] = []
            
            // 直接从RB容器的托管对象模型中获取实体名称
            let model = PersistenceController.shared.rbContainer.managedObjectModel
            // 转换为稳定的数组再遍历，避免集合在枚举时被修改
            let entitiesArray = Array(model.entities)
            for entity in entitiesArray {
                if let entityName = entity.name {
                    tables.append(entityName)
                    print("从模型中获取实体: \(entityName)")
                }
            }
            
            // 确保包含所有必要的表名（移除测试表：Category, Color, Part）
            let requiredTables = ["Colors", "Parts", "Elements", "Inventory_parts", "Part_relationships", "Parts_categories"]
            for table in requiredTables {
                if !tables.contains(table) {
                    tables.append(table)
                    print("添加必要表名: \(table)")
                }
            }
            
            // 去重
            tables = Array(Set(tables))
            
            print("数据库表列表: \(tables)")
            
            // 在主线程上更新UI
            DispatchQueue.main.async {
                self.databaseTables = tables
            }
        }
    }
    
    // 添加分页相关状态变量
    @State private var currentPage = 0
    @State private var pageSize = 50
    @State private var totalCount = 0
    @State private var hasMoreData = true
    
    // 加载所选表的数据（使用分页）
    func loadTableData(tableName: String) {
        // 重置分页状态
        currentPage = 0
        totalCount = 0
        hasMoreData = true
        tableData = []
        
        // 加载第一页数据
        loadPageData(tableName: tableName, page: 0)
    }
    
    // 加载指定页的数据
    func loadPageData(tableName: String, page: Int) {
        // 在后台线程上执行，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            let rbContext = PersistenceController.shared.rbContainer.viewContext
            
            var data: [NSManagedObject] = []
            var count = 0
            
            // 检查实体是否存在
            print("尝试加载表: \(tableName)")
            if let entity = NSEntityDescription.entity(forEntityName: tableName, in: rbContext) {
                print("实体\(tableName)存在，开始加载数据")
                
                // 打印实体的所有属性
                let attributes = entity.attributesByName
                let attributesKeys = Array(attributes.keys)
                print("实体属性: \(attributesKeys)")
                
                // 先获取数据总数
                do {
                    // 使用performAndWait确保在正确的线程上执行Core Data操作
                    rbContext.performAndWait {
                        let countRequest = NSFetchRequest<NSNumber>(entityName: tableName)
                        countRequest.resultType = .countResultType
                        // 显式设置实体描述，避免Core Data在查询时重新获取
                        countRequest.entity = entity
                        
                        do {
                            let countResult = try rbContext.fetch(countRequest)
                            count = countResult.first?.intValue ?? 0
                            print("\(tableName)表总数据条数: \(count)")
                        } catch {
                            print("获取数据总数失败: \(error)")
                            count = 0
                        }
                    }
                }
                
                // 创建查询请求
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: tableName)
                
                // 显式设置实体描述，避免Core Data在查询时重新获取
                fetchRequest.entity = entity
                
                // 设置分页参数
                fetchRequest.fetchOffset = page * self.pageSize
                fetchRequest.fetchLimit = self.pageSize
                
                // 为Inventory_parts表添加排序
                if tableName == "Inventory_parts" {
                    // 尝试添加排序，使用inventory_id字段
                    if attributesKeys.contains("inventory_id") {
                        let sortDescriptor = NSSortDescriptor(key: "inventory_id", ascending: true)
                        fetchRequest.sortDescriptors = [sortDescriptor]
                        print("为Inventory_parts表添加排序: inventory_id")
                    } else {
                        // 尝试使用其他可能的排序字段
                        let possibleSortFields = ["part_num", "color_id", "quantity"]
                        for field in possibleSortFields {
                            if attributesKeys.contains(field) {
                                let sortDescriptor = NSSortDescriptor(key: field, ascending: true)
                                fetchRequest.sortDescriptors = [sortDescriptor]
                                print("为Inventory_parts表添加排序: \(field)")
                                break
                            }
                        }
                    }
                } else {
                    // 为其他表添加默认排序
                    let possibleSortFields = ["id", "part_num", "inventory_id", "element_id"]
                    for field in possibleSortFields {
                        if attributesKeys.contains(field) {
                            let sortDescriptor = NSSortDescriptor(key: field, ascending: true)
                            fetchRequest.sortDescriptors = [sortDescriptor]
                            print("为\(tableName)表添加排序: \(field)")
                            break
                        }
                    }
                }
                
                // 使用performAndWait确保在正确的线程上执行Core Data操作
                rbContext.performAndWait {
                    do {
                        // 执行查询
                        let fetchedData = try rbContext.fetch(fetchRequest)
                        data = fetchedData
                        print("查询结果: \(data.count)条数据，偏移量: \(page * self.pageSize)")
                        
                        // 如果有数据，打印前几条数据的内容，以便调试
                        if !data.isEmpty {
                            print("前3条数据:")
                            // 转换为稳定的数组再枚举
                            let attributesArray = Array(attributes)
                            for i in 0..<min(3, data.count) {
                                let object = data[i]
                                var objectInfo = ""
                                for (key, _) in attributesArray {
                                    let value = object.value(forKey: key)
                                    objectInfo += "\(key): \(value ?? "nil"), "
                                }
                                print("第\(i+1)条: \(objectInfo)")
                            }
                        }
                    } catch {
                        print("加载\(tableName)表失败: \(error)")
                    }
                }
            } else {
                print("实体\(tableName)不存在")
                
                // 尝试检查RB容器中的所有实体
                let allEntities = rbContext.persistentStoreCoordinator?.managedObjectModel.entities
                if let entities = allEntities {
                    // 转换为稳定的数组再枚举，避免集合在枚举时被修改
                    let entitiesArray = Array(entities)
                    print("RB容器中的所有实体:")
                    for entity in entitiesArray {
                        if let entityName = entity.name {
                            print("- \(entityName)")
                        }
                    }
                }
            }
            
            // 在主线程上更新UI
            DispatchQueue.main.async {
                if page == 0 {
                    self.tableData = data
                } else {
                    // 使用临时数组来避免在遍历过程中修改集合
                    var updatedData = self.tableData
                    updatedData.append(contentsOf: data)
                    self.tableData = updatedData
                }
                self.totalCount = count
                self.hasMoreData = data.count >= self.pageSize
                self.currentPage = page
                print("UI更新完成，显示\(self.tableData.count)/\(count)条数据")
            }
        }
    }
    
    // 加载更多数据
    func loadMoreData() {
        if hasMoreData && selectedTable != nil {
            loadPageData(tableName: selectedTable!, page: currentPage + 1)
        }
    }
    

}