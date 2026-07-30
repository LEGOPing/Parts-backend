//
//  PartDetailView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData



struct PartDetailView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    var part: NSManagedObject
    @Binding var previousState: ViewState?

    @State private var quantity: Int32 = 0
    @State private var part_num: String = ""
    @State private var colorId: Int32 = 0
    @State private var showBoxSelection = false
    @State private var showColorPicker = false

    // 手动获取所有盒子
    private func getAllBoxes() -> [NSManagedObject] {
        var result: [NSManagedObject] = []
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Box")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "boxNumber", ascending: true)]
        do {
            result = try viewContext.fetch(fetchRequest)
        } catch {
            print("Error fetching boxes: \(error)")
        }
        return result
    }

    // 过滤当前仓库的盒子
    private var filteredBoxes: [NSManagedObject] {
        if let box = part.value(forKey: "box") as? NSManagedObject,
           let repository = box.value(forKey: "repository") as? NSManagedObject {
            return getAllBoxes().filter { 
                if let boxRepository = $0.value(forKey: "repository") as? NSManagedObject {
                    return boxRepository.objectID == repository.objectID
                }
                return false
            }
        }
        return []
    }

    // 获取颜色名称
    private func getColorName(from colorId: Int32) -> String? {
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
        fetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
        
        let persistence = PersistenceController.shared
        let colors = try? persistence.rbContainer.viewContext.fetch(fetchRequest)
        if let color = colors?.first {
            return color.value(forKey: "name") as? String
        }
        return nil
    }
    
    // 根据零件型号获取类别信息
    private func getCategoryInfo(for partNumber: String) -> (id: Int32, name: String)? {
        // 1. 首先从RB数据库的Parts表中根据零件型号获取part_cat_id
        let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
        partsFetchRequest.predicate = NSPredicate(format: "part_num == %@", partNumber)
        
        let persistence = PersistenceController.shared
        
        do {
            let parts = try persistence.rbContainer.viewContext.fetch(partsFetchRequest)
            if let part = parts.first {
                // 2. 获取part_cat_id
                let partCatId = part.value(forKey: "part_cat_id") as? Int32 ?? 0
                
                if partCatId > 0 {
                    // 3. 根据part_cat_id从Parts_categories表中获取类别名称
                    let categoriesFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts_categories")
                    categoriesFetchRequest.predicate = NSPredicate(format: "id == %d", partCatId)
                    
                    let categories = try persistence.rbContainer.viewContext.fetch(categoriesFetchRequest)
                    if let category = categories.first, let categoryName = category.value(forKey: "name") as? String {
                        return (id: partCatId, name: categoryName)
                    }
                }
            }
        } catch {
            print("Error fetching category info: \(error)")
        }
        return nil
    }
    
    // 获取总数量
    private func getTotalQuantity() -> Int32 {
        let partNumber = part.value(forKey: "part_num") as? String ?? ""
        let colorId = part.value(forKey: "color_id") as? Int32 ?? 0
        
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        fetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d", partNumber, colorId)
        
        do {
            let parts = try viewContext.fetch(fetchRequest)
            return parts.reduce(0) { $0 + ($1.value(forKey: "quantity") as? Int32 ?? 0) }
        } catch {
            print("Error fetching total quantity: \(error)")
            return 0
        }
    }
    
    // 获取所有包含该零件的盒子信息
    private func getAllPartLocations() -> [(box: NSManagedObject, isNew: Bool, quantity: Int32)] {
        let partNumber = part.value(forKey: "part_num") as? String ?? ""
        let colorId = part.value(forKey: "color_id") as? Int32 ?? 0
        let currentBox = part.value(forKey: "box") as? NSManagedObject
        
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
        fetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d", partNumber, colorId)
        
        do {
            let parts = try viewContext.fetch(fetchRequest)
            return parts.compactMap { part in
                if let box = part.value(forKey: "box") as? NSManagedObject {
                    // 过滤掉当前的盒子
                    if box.objectID == currentBox?.objectID {
                        return nil
                    }
                    let isNew = part.value(forKey: "is_new") as? Bool ?? false
                    let quantity = part.value(forKey: "quantity") as? Int32 ?? 0
                    return (box, isNew, quantity)
                }
                return nil
            }
        } catch {
            print("Error fetching part locations: \(error)")
            return []
        }
    }
    
    // 辅助视图：顶部栏
    private var topBar: some View {
        HStack {
            // 返回按钮
            Button(action: {
                if let prevState = previousState {
                    currentState = prevState
                } else if let box = part.value(forKey: "box") as? NSManagedObject {
                    currentState = .partManagement(box)
                } else {
                    currentState = .repositoryManagement
                }
            }) {
                Text("返回")
                    .font(.system(size: 14))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.blue)
                    .cornerRadius(4)
            }
            .padding()
            
            // 标题：零件详情，位于页面上方中央位置，与返回按钮同一行
            Text("零件详情")
                .font(.system(size: 24, weight: .bold))
                .padding()
                .frame(maxWidth: .infinity, alignment: .center)
            
            // 其他颜色按钮
            Button(action: {
                // 1. 提取零件的型号
                let partNumber = part.value(forKey: "part_num") as? String ?? ""
                print("Extracted part number: \(partNumber)")
                
                // 2. 触发视图一"零件搜索"按钮（进入搜索页面）
                // 先设置搜索零件型号到UserDefaults
                UserDefaults.standard.set(partNumber, forKey: "searchPartNumber")
                print("Set searchPartNumber in UserDefaults: \(partNumber)")
                
                // 3. 进入搜索页面
                currentState = .search
                print("Navigating to search page")
            }) {
                Text("其他颜色")
                    .font(.system(size: 14))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.green)
                    .cornerRadius(4)
            }
            .padding()
        }
    }
    
    // 辅助视图：型号信息行
    private var modelNumberRow: some View {
        HStack {
            Text("型号:")
                .font(.system(size: 16, weight: .bold))
                .frame(width: 80, alignment: .trailing)
            HStack {
                Text(part.value(forKey: "part_num") as? String ?? "未定义型号")
                    .font(.system(size: 16))
                    .foregroundColor(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                let isNew = part.value(forKey: "is_new") as? Bool ?? false
                Text("\(isNew ? "新" : "旧") \(part.value(forKey: "quantity") as? Int32 ?? 0)")
                    .font(.system(size: 16))
                    .foregroundColor(isNew ? .green : .orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
    }
    
    // 辅助视图：名称信息行
    private var nameRow: some View {
        HStack {
            Text("名称:")
                .font(.system(size: 16, weight: .bold))
                .frame(width: 80, alignment: .trailing)
            Text(part.value(forKey: "name") as? String ?? "未命名零件")
                .font(.system(size: 16))
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
    }
    
    // 辅助视图：类别信息行
    private var categoryRow: some View {
        HStack {
            Text("类别:")
                .font(.system(size: 16, weight: .bold))
                .frame(width: 80, alignment: .trailing)
            HStack {
                let partNumber = part.value(forKey: "part_num") as? String ?? ""
                if let categoryInfo = getCategoryInfo(for: partNumber) {
                    Text("ID: \(categoryInfo.id)")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("名称: \(categoryInfo.name)")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("ID: 未知")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("名称: 未知")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
    }
    
    // 辅助视图：颜色信息行
    private var colorRow: some View {
        HStack {
            Text("颜色:")
                .font(.system(size: 16, weight: .bold))
                .frame(width: 80, alignment: .trailing)
            HStack {
                Text("ID: \(part.value(forKey: "color_id") as? Int32 ?? 0)")
                    .font(.system(size: 14))
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let colorName = getColorName(from: part.value(forKey: "color_id") as? Int32 ?? 0) {
                    Text("名称: \(colorName)")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("名称: 未知")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
    }
    
    // 辅助视图：位置信息行
    private var locationRow: some View {
        HStack {
            Text("位置:")
                .font(.system(size: 16, weight: .bold))
                .frame(width: 80, alignment: .trailing)
            HStack {
                if let box = part.value(forKey: "box") as? NSManagedObject {
                    if let repository = box.value(forKey: "repository") as? NSManagedObject {
                        // 点击仓库可进入该仓库的仓库管理页面
                        Button(action: {
                            currentState = .boxManagement(repository)
                        }) {
                            let repoName = repository.value(forKey: "name") as? String ?? "未命名仓库"
                            Text("仓库: \(repoName)")
                                .font(.system(size: 14))
                                .foregroundColor(.blue)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        
                        // 点击盒子可进入该盒子的盒子管理页面
                        Button(action: {
                            currentState = .partManagement(box)
                        }) {
                            let boxName = box.value(forKey: "name") as? String ?? "未命名盒子"
                            Text("盒子: \(boxName)")
                                .font(.system(size: 14))
                                .foregroundColor(.blue)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                } else {
                    Text("未分配盒子")
                        .font(.system(size: 14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
    }
    
    // 辅助视图：其他位置列表
    private var otherLocationsList: some View {
        let locations = getAllPartLocations()
        if locations.isEmpty {
            return AnyView(
                Text("无其他位置")
                    .font(.system(size: 14))
                    .padding()
            )
        } else {
            return AnyView(
                ForEach(locations, id: \.box.objectID) {
                    location in
                    if let repository = location.box.value(forKey: "repository") as? NSManagedObject {
                        // 点击该行，可以进入当前型号在点选盒子的零件详情页面
                        Button(action: {
                            // 查找点选盒子中的该型号零件
                            let partNumber = part.value(forKey: "part_num") as? String ?? ""
                            let colorId = part.value(forKey: "color_id") as? Int32 ?? 0
                            let isNew = location.isNew
                            
                            let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                            fetchRequest.predicate = NSPredicate(format: "part_num == %@ AND color_id == %d AND is_new == %@ AND box == %@", partNumber, colorId, NSNumber(value: isNew), location.box)
                            
                            do {
                                let targetParts = try viewContext.fetch(fetchRequest)
                                if let targetPart = targetParts.first {
                                    currentState = .partDetail(targetPart)
                                }
                            } catch {
                                print("Error fetching target part: \(error)")
                            }
                        }) {
                            VStack(alignment: .leading, spacing: 5) {
                                // 第1行："仓库："+仓库（左对齐），单纯的零件状态（右对齐，新为绿色字，旧用红色字）
                                HStack {
                                    let repoName = repository.value(forKey: "name") as? String ?? "未命名仓库"
                                    Text("仓库: \(repoName)")
                                        .font(.system(size: 12))
                                    Spacer()
                                    Text(location.isNew ? "新" : "旧")
                                        .font(.system(size: 12))
                                        .foregroundColor(location.isNew ? .green : .red)
                                }
                                // 第2行："盒子："+盒子（左对齐），单纯的零件数量（右对齐，绿色字，粗体）
                                HStack {
                                    let boxName = location.box.value(forKey: "name") as? String ?? "未命名盒子"
                                    Text("盒子: \(boxName)")
                                        .font(.system(size: 12))
                                    Spacer()
                                    Text(String(location.quantity))
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundColor(.green)
                                }
                            }
                            .padding()
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal, 10)
                        }
                    }
                }
            )
        }
    }
    
    // 辅助视图：盒子选择Sheet
    private var boxSelectionSheet: some View {
        VStack {
            Text("选择目标盒子")
                .font(.system(size: 18, weight: .bold))
                .padding()
            
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(filteredBoxes, id: \.objectID) { box in
                        Button(action: {
                            // 更改零件所属盒子
                            part.setValue(box, forKey: "box")
                            // 检查Part实体是否有boxId属性
                            let entity = part.entity
                            if entity.attributesByName.keys.contains("boxId"),
                               let boxId = box.value(forKey: "id") as? Int32 {
                                part.setValue(boxId, forKey: "boxId")
                            }
                            saveContext()
                            showBoxSelection = false
                        }) {
                            HStack {
                                Text(box.value(forKey: "name") as? String ?? "未命名盒子")
                                    .font(.system(size: 16))
                                Text("(ID: " + String(describing: box.value(forKey: "boxNumber") as? Int32 ?? 0) + ")")
                                    .font(.system(size: 14))
                                    .foregroundColor(.gray)
                                Spacer()
                            }
                            .padding()
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal, 40)
                        }
                    }
                }
            }
            
            Button(action: {
                showBoxSelection = false
            }) {
                Text("取消")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
                    .background(Color.gray)
                    .cornerRadius(8)
            }
            .padding(.top, 20)
        }
        .padding()
    }
    
    // 辅助视图：颜色选择Sheet
    private var colorPickerSheet: some View {
        if let partNumber = part.value(forKey: "part_num") as? String {
            return AnyView(
                ColorPickerView(partNumber: partNumber, onColorSelected: {
                    selectedColorId in
                    part.setValue(selectedColorId, forKey: "color_id")
                    colorId = selectedColorId
                    saveContext()
                }, source: .searchPart)
            )
        } else {
            return AnyView(EmptyView())
        }
    }
    
    var body: some View {
        GeometryReader { geometry in
            // 计算视图大小为屏幕的80%宽度，50%高度
            let viewWidth = geometry.size.width * 0.8
            let viewHeight = geometry.size.height * 0.5
            
            VStack {
                // 顶部栏：包含返回按钮、标题和其他颜色按钮
                topBar
                
                // 标题下面页面分左右两部分（左2/3，右1/3）
                HStack(spacing: 20) {
                    // 左边部分（2/3宽度）
                    VStack(spacing: 15) {
                        // 零件图片（与零件管理页面使用相同的加载逻辑）
                        PartImageLoader(
                            partNum: part.value(forKey: "part_num") as? String ?? "",
                            colorId: part.value(forKey: "color_id") as? Int32 ?? 0
                        )
                            .frame(height: viewHeight * 0.4)
                            .background(Color.gray.opacity(0.2))
                            .cornerRadius(8)
                            .padding()
                        
                        // 型号
                        modelNumberRow
                        
                        // 名称
                        nameRow
                        
                        // 类别
                        categoryRow
                        
                        // 颜色：ID（左）名称（右）
                        colorRow
                        
                        // 位置：仓库（左）盒子（右）
                        locationRow
                    }
                    .frame(width: viewWidth * (2/3))
                    
                    // 右边部分（1/3宽度）
                    VStack(spacing: 10) {
                        // 小标题：其他位置
                        Text("其他位置")
                            .font(.system(size: 18, weight: .bold))
                            .padding()
                        
                        // 显示不同仓库和不同盒子的位置、新旧状态和数量
                        ScrollView {
                            otherLocationsList
                        }
                    }
                    .frame(width: viewWidth * (1/3))
                    .background(Color.gray.opacity(0.05))
                    .cornerRadius(8)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
            .frame(width: viewWidth, height: viewHeight)
            .background(Color.white)
            .cornerRadius(12)
            .shadow(radius: 10)
            .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
        }
        .sheet(isPresented: $showBoxSelection) {
            boxSelectionSheet
        }
        .onAppear {
            // 初始化编辑字段
            quantity = part.value(forKey: "quantity") as? Int32 ?? 0
            part_num = part.value(forKey: "part_num") as? String ?? ""
            colorId = part.value(forKey: "color_id") as? Int32 ?? 0
        }
        .sheet(isPresented: $showColorPicker) {
            colorPickerSheet
        }
    }

    private func saveContext() {
        do {
            try viewContext.save()
        } catch {
            let nsError = error as NSError
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
    }
}
