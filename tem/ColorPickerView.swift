import SwiftUI
import CoreData

struct ColorPickerView: View {
    let partNumber: String
    let onColorSelected: (Int32) -> Void
    let onApply: (() -> Void)?
    let source: ColorPickerSource
    let isMultiSelect: Bool
    @State private var availableColors: [(id: Int32, name: String, rgb: String)] = []
    @State private var selectedColors: [Int32] = []
    @Environment(\.dismiss) private var dismiss
    
    enum ColorPickerSource {
        case addPart // 从RB数据库的Elements表获取
        case searchPart // 从系统数据库的Part表获取
    }
    
    init(partNumber: String, onColorSelected: @escaping (Int32) -> Void, source: ColorPickerSource, isMultiSelect: Bool = false, onApply: (() -> Void)? = nil) {
        self.partNumber = partNumber
        self.onColorSelected = onColorSelected
        self.source = source
        self.isMultiSelect = isMultiSelect
        self.onApply = onApply
    }
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 标题栏
                HStack {
                    Text("选择颜色")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                    Spacer()
                    if isMultiSelect {
                        Button(action: {
                            selectedColors = []
                        }) {
                            Text("清空选择")
                                .font(.system(size: 14))
                                .foregroundColor(.blue)
                        }
                        .padding(.trailing, 10)
                    }
                    Button(action: {
                        dismiss()
                    }) {
                        Text("关闭")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 10)
                .overlay(
                    Rectangle()
                        .frame(height: 1, alignment: .bottom)
                        .foregroundColor(Color.gray.opacity(0.2))
                    , alignment: .bottom
                )
                
                // 颜色列表
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 15) {
                        ForEach(availableColors, id: \.id) {
                            color in
                            Button(action: {
                                if isMultiSelect {
                                    // 切换选择状态
                                    if let index = selectedColors.firstIndex(of: color.id) {
                                        selectedColors.remove(at: index)
                                    } else {
                                        selectedColors.append(color.id)
                                    }
                                    // 选择颜色时就把选择结果传给颜色ID输入框
                                    onColorSelected(color.id)
                                } else {
                                    // 单选模式
                                    onColorSelected(color.id)
                                    dismiss()
                                }
                            }) {
                                VStack(spacing: 8) {
                                    // 颜色预览
                                    ZStack {
                                        Color(rgbHex: color.rgb)
                                            .frame(width: 60, height: 60)
                                            .cornerRadius(8)
                                            .border(Color.gray.opacity(0.3), width: 1)
                                        
                                        // 选中状态指示器
                                        if isMultiSelect && selectedColors.contains(color.id) {
                                            Image(systemName: "checkmark.circle.fill")
                                                .resizable()
                                                .frame(width: 24, height: 24)
                                                .foregroundColor(.blue)
                                                .offset(x: 20, y: -20)
                                        }
                                    }
                                    
                                    // 颜色信息
                                    VStack(spacing: 4) {
                                        Text(color.name)
                                            .font(.system(size: 12, weight: .medium))
                                            .lineLimit(2)
                                            .multilineTextAlignment(.center)
                                        Text("ID: \(color.id)")
                                            .font(.system(size: 10))
                                            .foregroundColor(.gray)
                                    }
                                    .padding(8)
                                }
                                .padding(8)
                                .background(Color.white)
                                .cornerRadius(8)
                                .shadow(radius: 2)
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    .padding(20)
                }
                

            }
            .background(Color(red: 0xf5/255, green: 0xf5/255, blue: 0xf5/255))
            .onAppear {
                fetchAvailableColors()
            }
        }
    }
    
    // 获取可用颜色
    private func fetchAvailableColors() {
        DispatchQueue.global(qos: .userInitiated).async {
            let persistence = PersistenceController.shared
            var colors: [(id: Int32, name: String, rgb: String)] = []
            
            switch self.source {
            case .addPart:
                // 从RB数据库的Elements表获取
                let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                rbPrivateContext.parent = persistence.rbContainer.viewContext
                
                rbPrivateContext.performAndWait { 
                    // 从RB数据库的Elements表中获取该零件型号的所有颜色ID
                    let elementsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Elements")
                    
                    // 根据零件型号筛选
                    if !self.partNumber.isEmpty {
                        elementsFetchRequest.predicate = NSPredicate(format: "part_num == %@", self.partNumber)
                    }
                    
                    do {
                        let elements = try rbPrivateContext.fetch(elementsFetchRequest)
                        print("获取到Elements数量: \(elements.count)")
                        
                        // 获取所有不同的颜色ID
                        var colorIds: Set<Int32> = []
                        for element in elements {
                            if let colorId = element.value(forKey: "color_id") as? Int32 {
                                colorIds.insert(colorId)
                            }
                        }
                        print("获取到颜色ID数量: \(colorIds.count)")
                        
                        // 从RB数据库的Colors表中获取颜色信息
                        for colorId in colorIds {
                            let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                            colorFetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
                            
                            do {
                                let colorResults = try rbPrivateContext.fetch(colorFetchRequest)
                                if let color = colorResults.first {
                                    if let name = color.value(forKey: "name") as? String,
                                       let rgb = color.value(forKey: "rgb") as? String {
                                        colors.append((id: colorId, name: name, rgb: rgb))
                                        print("添加颜色: \(name) (ID: \(colorId), RGB: \(rgb))")
                                    }
                                }
                            } catch {
                                print("Error fetching color: \(error)")
                            }
                        }
                        
                        // 按颜色名称排序
                        colors.sort { $0.name < $1.name }
                        print("最终颜色数量: \(colors.count)")
                        
                    } catch {
                        print("Error fetching elements: \(error)")
                        
                        // 如果出错，获取所有颜色作为备选
                        let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                        do {
                            let colorResults = try rbPrivateContext.fetch(colorFetchRequest)
                            print("获取到所有颜色数量: \(colorResults.count)")
                            for color in colorResults {
                                if let colorId = color.value(forKey: "id") as? Int32,
                                   let name = color.value(forKey: "name") as? String,
                                   let rgb = color.value(forKey: "rgb") as? String {
                                    colors.append((id: colorId, name: name, rgb: rgb))
                                }
                            }
                            colors.sort { $0.name < $1.name }
                            print("备选颜色数量: \(colors.count)")
                        } catch {
                            print("Error fetching all colors: \(error)")
                        }
                    }
                }
            
            case .searchPart:
                // 从系统数据库的Part表获取
                let systemPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                systemPrivateContext.parent = persistence.container.viewContext
                
                systemPrivateContext.performAndWait { 
                    // 从系统数据库的Part表中获取该零件型号的所有颜色ID
                    let partsFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
                    
                    // 根据零件型号筛选
                    if !self.partNumber.isEmpty {
                        partsFetchRequest.predicate = NSPredicate(format: "part_num == %@", self.partNumber)
                    }
                    
                    do {
                        let parts = try systemPrivateContext.fetch(partsFetchRequest)
                        print("获取到Parts数量: \(parts.count)")
                        
                        // 获取所有不同的颜色ID
                        var colorIds: Set<Int32> = []
                        for part in parts {
                            if let colorId = part.value(forKey: "color_id") as? Int32 {
                                colorIds.insert(colorId)
                            }
                        }
                        print("获取到颜色ID数量: \(colorIds.count)")
                        
                        // 从RB数据库的Colors表中获取颜色信息（系统数据库可能没有Color实体）
                        let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                        rbPrivateContext.parent = persistence.rbContainer.viewContext
                        
                        for colorId in colorIds {
                            let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                            colorFetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
                            
                            do {
                                let colorResults = try rbPrivateContext.fetch(colorFetchRequest)
                                if let color = colorResults.first {
                                    if let name = color.value(forKey: "name") as? String,
                                       let rgb = color.value(forKey: "rgb") as? String {
                                        colors.append((id: colorId, name: name, rgb: rgb))
                                        print("添加颜色: \(name) (ID: \(colorId), RGB: \(rgb))")
                                    }
                                }
                            } catch {
                                print("Error fetching color: \(error)")
                            }
                        }
                        
                        // 按颜色名称排序
                        colors.sort { $0.name < $1.name }
                        print("最终颜色数量: \(colors.count)")
                        
                        // 如果没有找到颜色，尝试获取所有颜色作为备选
                        if colors.isEmpty {
                            print("未找到颜色，尝试获取所有颜色作为备选")
                            let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                            rbPrivateContext.parent = persistence.rbContainer.viewContext
                            
                            let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                            do {
                                let colorResults = try rbPrivateContext.fetch(colorFetchRequest)
                                print("获取到所有颜色数量: \(colorResults.count)")
                                for color in colorResults {
                                    if let colorId = color.value(forKey: "id") as? Int32,
                                       let name = color.value(forKey: "name") as? String,
                                       let rgb = color.value(forKey: "rgb") as? String {
                                        colors.append((id: colorId, name: name, rgb: rgb))
                                    }
                                }
                                colors.sort { $0.name < $1.name }
                                print("备选颜色数量: \(colors.count)")
                            } catch {
                                print("Error fetching all colors: \(error)")
                            }
                        }
                        
                    } catch {
                        print("Error fetching parts: \(error)")
                        
                        // 如果出错，尝试获取所有颜色作为备选
                        print("获取零件出错，尝试获取所有颜色作为备选")
                        let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
                        rbPrivateContext.parent = persistence.rbContainer.viewContext
                        
                        let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
                        do {
                            let colorResults = try rbPrivateContext.fetch(colorFetchRequest)
                            print("获取到所有颜色数量: \(colorResults.count)")
                            for color in colorResults {
                                if let colorId = color.value(forKey: "id") as? Int32,
                                   let name = color.value(forKey: "name") as? String,
                                   let rgb = color.value(forKey: "rgb") as? String {
                                    colors.append((id: colorId, name: name, rgb: rgb))
                                }
                            }
                            colors.sort { $0.name < $1.name }
                            print("备选颜色数量: \(colors.count)")
                        } catch {
                            print("Error fetching all colors: \(error)")
                        }
                    }
                }
            }
            
            // 更新UI
            DispatchQueue.main.async {
                print("更新UI，颜色数量: \(colors.count)")
                self.availableColors = colors
            }
        }
    }
}






